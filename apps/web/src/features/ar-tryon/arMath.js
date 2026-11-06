/**
 * Pure maths for the real-time AR try-on (no React, no three.js, no DOM): camera/box coordinate mapping,
 * landmark analysis, jitter smoothing and garment placement. Everything here is unit-tested without a camera.
 *
 * Coordinate conventions
 *  - MediaPipe landmarks are normalized to the VIDEO frame (x right, y down, z "towards camera is smaller").
 *  - "Box" coordinates are CSS pixels inside the stage element (origin top-left, y down).
 *  - The video is shown with `object-fit: cover` and, for the front camera, mirrored. `toBox` applies both, so
 *    the garment is placed in exactly the same coordinate space as the picture the customer sees.
 *
 * Honest limits: this derives a 2D anchor (shoulders), a size, a roll angle and a rough yaw from sparse landmarks.
 * It does not measure the body, simulate cloth, or know which arm is in front of the garment.
 */

/** MediaPipe Pose landmark indices used here. */
export const LM = Object.freeze({
  NOSE: 0, L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14, L_WRIST: 15, R_WRIST: 16, L_HIP: 23, R_HIP: 24,
});

export const MIN_VISIBILITY = 0.5;
/** Fraction of the stage width the shoulders should span: outside this range the customer is told to move. */
export const SHOULDER_FRACTION = Object.freeze({ tooFar: 0.14, tooClose: 0.7 });
/** Typical shoulder-to-hip length divided by shoulder width; used only when the hips are not visible. */
export const TORSO_TO_SHOULDER_RATIO = 1.3;
/** Yaw (turning left/right) is noisy with one camera: dead-zone, damping and a hard limit. */
export const YAW = Object.freeze({ deadZone: 0.07, gain: 0.8, max: 0.6 });

/** Positioning profiles. Different garment types do NOT share one formula. */
export const PROFILES = Object.freeze({
  top: { widthFactor: 1.5, lengthFactor: 1.12, collarRise: 0.1 },
  outerwear: { widthFactor: 1.72, lengthFactor: 1.3, collarRise: 0.12 },
});
/** A garment may extend at most this much beyond the profile length before it is shrunk to fit. */
const MAX_LENGTH_SLACK = 1.4;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Where a source (video) of size srcW x srcH ends up inside a box when drawn with object-fit: cover.
 * @returns {{scale:number, offsetX:number, offsetY:number}}
 */
export function coverTransform(srcW, srcH, boxW, boxH) {
  if (!(srcW > 0 && srcH > 0 && boxW > 0 && boxH > 0)) return { scale: 1, offsetX: 0, offsetY: 0 };
  const scale = Math.max(boxW / srcW, boxH / srcH);
  return { scale, offsetX: (boxW - srcW * scale) / 2, offsetY: (boxH - srcH * scale) / 2 };
}

/**
 * Map a normalized video landmark to box pixels (cover crop + optional horizontal mirror).
 * @param {{x:number,y:number}} lm
 * @param {{srcW:number, srcH:number, boxW:number, boxH:number, mirrored:boolean}} view
 */
export function toBox(lm, view) {
  const c = coverTransform(view.srcW, view.srcH, view.boxW, view.boxH);
  const x = lm.x * view.srcW * c.scale + c.offsetX;
  return { x: view.mirrored ? view.boxW - x : x, y: lm.y * view.srcH * c.scale + c.offsetY };
}

/** Landmark counts as usable when the model is confident it is visible AND it lies inside the video frame. */
export function isVisible(lm, min = MIN_VISIBILITY) {
  if (!lm) return false;
  const v = lm.visibility ?? 1;
  return v >= min && lm.x > -0.02 && lm.x < 1.02 && lm.y > -0.02 && lm.y < 1.02;
}

/**
 * Interpret one pose (33 landmarks) for upper-body garments.
 * `status`: 'none' = cannot place a garment; 'partial' = placed with an estimated torso length; 'ok' = shoulders and hips seen.
 * @param {Array<{x:number,y:number,z:number,visibility?:number}>|undefined|null} landmarks
 * @param {{srcW:number, srcH:number, boxW:number, boxH:number, mirrored:boolean}} view
 */
export function analyzeUpperBody(landmarks, view) {
  const none = (reason) => ({ status: 'none', reason, hints: [], visible: { shoulders: false, elbows: false, wrists: false, hips: false }, points: {} });
  if (!landmarks || landmarks.length < 25) return none('no_body');

  const l = landmarks;
  const sh = [l[LM.L_SHOULDER], l[LM.R_SHOULDER]];
  const shoulders = sh.every((p) => isVisible(p));
  if (!shoulders) return none('shoulders_hidden');

  // Order by SCREEN position so left/right, roll and yaw signs do not depend on mirroring.
  const pts = sh.map((p) => ({ ...toBox(p, view), z: p.z }));
  const [sL, sR] = pts[0].x <= pts[1].x ? pts : [pts[1], pts[0]];
  const shoulderWidth = Math.hypot(sR.x - sL.x, sR.y - sL.y);
  if (!(shoulderWidth > 1)) return none('shoulders_hidden');
  const mid = { x: (sL.x + sR.x) / 2, y: (sL.y + sR.y) / 2 };

  const hipsVisible = isVisible(l[LM.L_HIP]) && isVisible(l[LM.R_HIP]);
  let hipMid = null;
  let torsoLength = shoulderWidth * TORSO_TO_SHOULDER_RATIO;
  if (hipsVisible) {
    const h1 = toBox(l[LM.L_HIP], view);
    const h2 = toBox(l[LM.R_HIP], view);
    hipMid = { x: (h1.x + h2.x) / 2, y: (h1.y + h2.y) / 2 };
    const measured = Math.hypot(hipMid.x - mid.x, hipMid.y - mid.y);
    // A hip estimate that is implausibly short/long (a mis-detection) falls back to the estimate.
    if (measured > shoulderWidth * 0.6 && measured < shoulderWidth * 3) torsoLength = measured;
    else hipMid = null;
  }

  // Roll: tilt of the shoulder line. y is down in the box, so a lower right shoulder gives a clockwise (negative) angle.
  const rollRad = -Math.atan2(sR.y - sL.y, sR.x - sL.x);

  // Yaw (rough): depth difference between the shoulders relative to their horizontal span. Positive = screen-right shoulder further away.
  const dxn = Math.abs(sh[0].x - sh[1].x) || 1e-6;
  const dz = sR.z - sL.z;
  const rawYaw = Math.atan2(dz, dxn);
  const yawRad = Math.abs(rawYaw) < YAW.deadZone ? 0 : clamp((rawYaw - Math.sign(rawYaw) * YAW.deadZone) * YAW.gain, -YAW.max, YAW.max);

  const elbows = isVisible(l[LM.L_ELBOW]) && isVisible(l[LM.R_ELBOW]);
  const wrists = isVisible(l[LM.L_WRIST]) && isVisible(l[LM.R_WRIST]);

  const hints = [];
  const fraction = shoulderWidth / view.boxW;
  if (fraction < SHOULDER_FRACTION.tooFar) hints.push('too_far');
  if (fraction > SHOULDER_FRACTION.tooClose) hints.push('too_close');
  if (!hipMid) hints.push('hips_hidden');

  const named = { lShoulder: sL, rShoulder: sR, shoulderMid: mid };
  if (hipMid) named.hipMid = hipMid;
  for (const [name, i] of [['elbowA', LM.L_ELBOW], ['elbowB', LM.R_ELBOW], ['wristA', LM.L_WRIST], ['wristB', LM.R_WRIST]]) {
    if (isVisible(l[i])) named[name] = toBox(l[i], view);
  }

  return {
    status: hipMid ? 'ok' : 'partial',
    reason: null,
    hints,
    visible: { shoulders: true, elbows, wrists, hips: !!hipMid },
    shoulderMid: mid,
    shoulderWidth,
    torsoLength,
    torsoEstimated: !hipMid,
    rollRad,
    yawRad,
    points: named,
  };
}

// ------------------------------------------------------------------ smoothing

const lowPassAlpha = (cutoffHz, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoffHz) / dt);

/**
 * One Euro filter (Casiez et al., 2012): heavy smoothing while the signal is nearly still (kills jitter),
 * light smoothing while it moves fast (no lag). Works on one scalar.
 */
export class OneEuroFilter {
  /** @param {{minCutoff?:number, beta?:number, dCutoff?:number}} [p] */
  constructor({ minCutoff = 1.2, beta = 10, dCutoff = 1 } = {}) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.reset();
  }

  reset() { this.x = null; this.dx = 0; }

  /** @param {number} value @param {number} dt seconds since the previous sample */
  filter(value, dt) {
    const step = clamp(dt, 1 / 240, 0.25);
    if (this.x === null) { this.x = value; this.dx = 0; return value; }
    const rawDx = (value - this.x) / step;
    this.dx += lowPassAlpha(this.dCutoff, step) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += lowPassAlpha(cutoff, step) * (value - this.x);
    return this.x;
  }
}

/** How long a lost pose is kept on screen before the garment is hidden, and how long before filters are reset. */
export const HOLD_MS = 500;
export const RESET_AFTER_MS = 1000;

/**
 * Turns noisy per-frame analyses into a stable placement and a tracking state:
 *  - 'tracking' (seen now), 'holding' (lost < HOLD_MS: garment stays), 'lost' (garment hidden).
 * Lengths are normalized by the stage width so the filter settings do not depend on screen size; the filters are
 * reset when the stage size changes (device rotation) or the body was gone for a while (no smoothing across a jump).
 */
export class PoseSmoother {
  constructor() {
    this.f = {
      x: new OneEuroFilter(), y: new OneEuroFilter(), w: new OneEuroFilter(), torso: new OneEuroFilter(),
      roll: new OneEuroFilter({ minCutoff: 1, beta: 1.5 }), yaw: new OneEuroFilter({ minCutoff: 0.6, beta: 0.8 }),
    };
    this.reset();
  }

  reset() {
    Object.values(this.f).forEach((f) => f.reset());
    this.lastSeen = -Infinity; this.lastT = null; this.size = null; this.last = null;
  }

  /**
   * @param {ReturnType<typeof analyzeUpperBody>} a
   * @param {number} tMs timestamp (ms, monotonic)
   * @param {{boxW:number, boxH:number}} box
   * @returns {{state:'tracking'|'holding'|'lost', reason:string|null, hints:string[], pose:null|{x:number,y:number,shoulderWidth:number,torsoLength:number,rollRad:number,yawRad:number}, visible:object, points:object}}
   */
  update(a, tMs, box) {
    if (this.size && (Math.abs(this.size.w - box.boxW) > 1 || Math.abs(this.size.h - box.boxH) > 1)) this.reset();
    this.size = { w: box.boxW, h: box.boxH };
    const ref = box.boxW || 1;

    if (a.status !== 'none') {
      if (tMs - this.lastSeen > RESET_AFTER_MS) Object.values(this.f).forEach((f) => f.reset());
      const dt = this.lastT === null ? 1 / 30 : (tMs - this.lastT) / 1000;
      this.lastSeen = tMs; this.lastT = tMs;
      this.last = {
        x: this.f.x.filter(a.shoulderMid.x / ref, dt) * ref,
        y: this.f.y.filter(a.shoulderMid.y / ref, dt) * ref,
        shoulderWidth: this.f.w.filter(a.shoulderWidth / ref, dt) * ref,
        torsoLength: this.f.torso.filter(a.torsoLength / ref, dt) * ref,
        rollRad: this.f.roll.filter(a.rollRad, dt),
        yawRad: this.f.yaw.filter(a.yawRad, dt),
      };
      return { state: 'tracking', reason: null, hints: a.hints, pose: this.last, visible: a.visible, points: a.points };
    }

    const gone = tMs - this.lastSeen;
    if (this.last && gone <= HOLD_MS) return { state: 'holding', reason: a.reason, hints: [], pose: this.last, visible: a.visible, points: a.points };
    return { state: 'lost', reason: a.reason, hints: [], pose: null, visible: a.visible, points: a.points };
  }
}

// ------------------------------------------------------------------ garment placement

/**
 * Garment-type specific placement for a smoothed pose.
 * `topLocalY` is measured in the garment's own frame (origin = shoulder midpoint, +y up the spine): where the top edge goes.
 * @param {{shoulderWidth:number, torsoLength:number, rollRad:number, yawRad:number, x:number, y:number}} pose
 * @param {{garmentType:keyof typeof PROFILES, scaleAdjust?:number, offsetYAdjust?:number}} cfg offsetYAdjust > 0 moves the garment DOWN
 */
export function computePlacement(pose, { garmentType = 'top', scaleAdjust = 1, offsetYAdjust = 0 } = {}) {
  const p = PROFILES[garmentType] || PROFILES.top;
  const s = clamp(scaleAdjust, 0.3, 2.5);
  return {
    pivot: { x: pose.x, y: pose.y },
    rollRad: pose.rollRad,
    yawRad: pose.yawRad,
    targetWidth: pose.shoulderWidth * p.widthFactor * s,
    maxHeight: pose.torsoLength * p.lengthFactor * MAX_LENGTH_SLACK * s,
    topLocalY: (p.collarRise - offsetYAdjust) * pose.torsoLength,
  };
}

/**
 * Uniformly scale a garment of the given proportions: match the target width, but never exceed the allowed length.
 * The garment's own proportions are kept (never stretched).
 * @returns {{width:number, height:number, scale:number}} `scale` multiplies the source size
 */
export function fitGarment(srcW, srcH, { targetWidth, maxHeight }) {
  if (!(srcW > 0 && srcH > 0)) return { width: 0, height: 0, scale: 0 };
  const scale = Math.min(targetWidth / srcW, maxHeight / srcH);
  return { width: srcW * scale, height: srcH * scale, scale };
}

// ------------------------------------------------------------------ messages

/** Customer-facing guidance for a tracking state. Returns null when nothing needs to be said. */
export function guidanceFor({ state, reason, hints }) {
  if (state === 'lost' || state === 'holding') {
    if (reason === 'shoulders_hidden') return 'Keep both shoulders inside the picture.';
    return 'We can’t see you. Step into the picture and face the camera.';
  }
  if (hints?.includes('too_close')) return 'You’re very close. Step back a little.';
  if (hints?.includes('too_far')) return 'Move a little closer so your upper body fills more of the picture.';
  if (hints?.includes('hips_hidden')) return 'Step back until your hips are visible for a better fit.';
  return null;
}
