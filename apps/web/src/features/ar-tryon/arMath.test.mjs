import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LM, OneEuroFilter, PoseSmoother, analyzeUpperBody, computePlacement, coverTransform, fitGarment, guidanceFor, toBox, HOLD_MS,
} from './arMath.js';

/** Build a 33-landmark pose. Coordinates are normalized to the video frame. */
function pose(over = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const set = (i, x, y, z = 0, visibility = 0.99) => { lm[i] = { x, y, z, visibility }; };
  set(LM.L_SHOULDER, 0.6, 0.3); set(LM.R_SHOULDER, 0.4, 0.3); // person's left shoulder is on the image RIGHT (unmirrored video)
  set(LM.L_ELBOW, 0.65, 0.45); set(LM.R_ELBOW, 0.35, 0.45);
  set(LM.L_WRIST, 0.66, 0.6); set(LM.R_WRIST, 0.34, 0.6);
  set(LM.L_HIP, 0.57, 0.62); set(LM.R_HIP, 0.43, 0.62);
  for (const [i, v] of Object.entries(over)) lm[Number(i)] = { ...lm[Number(i)], ...v };
  return lm;
}
const VIEW = { srcW: 1280, srcH: 720, boxW: 1280, boxH: 720, mirrored: false };

test('coverTransform: same aspect = identity; narrower box crops the sides; taller box crops the sides of a wide video', () => {
  assert.deepEqual(coverTransform(1280, 720, 1280, 720), { scale: 1, offsetX: 0, offsetY: 0 });
  const c = coverTransform(1280, 720, 360, 640); // phone portrait box, landscape video
  assert.ok(Math.abs(c.scale - 640 / 720) < 1e-9);
  assert.ok(c.offsetX < 0 && c.offsetY === 0);
  assert.deepEqual(coverTransform(0, 0, 100, 100), { scale: 1, offsetX: 0, offsetY: 0 }, 'bad input does not produce NaN');
});

test('toBox: mirror flips x only; cover crop is applied before mirroring so overlay and video stay aligned', () => {
  const p = { x: 0.25, y: 0.5 };
  const plain = toBox(p, VIEW);
  const mirror = toBox(p, { ...VIEW, mirrored: true });
  assert.equal(plain.x, 320); assert.equal(mirror.x, 960); assert.equal(plain.y, mirror.y);
  const portrait = { srcW: 1280, srcH: 720, boxW: 360, boxH: 640, mirrored: false };
  const centre = toBox({ x: 0.5, y: 0.5 }, portrait);
  assert.ok(Math.abs(centre.x - 180) < 1e-9 && Math.abs(centre.y - 320) < 1e-9, 'video centre stays at box centre');
  const m = toBox({ x: 0.3, y: 0.2 }, { ...portrait, mirrored: true });
  const u = toBox({ x: 0.3, y: 0.2 }, portrait);
  assert.ok(Math.abs(m.x - (360 - u.x)) < 1e-9);
});

test('analyzeUpperBody: full upper body is "ok" with measured torso, roll 0 and yaw 0', () => {
  const a = analyzeUpperBody(pose(), VIEW);
  assert.equal(a.status, 'ok');
  assert.equal(a.torsoEstimated, false);
  assert.deepEqual(a.visible, { shoulders: true, elbows: true, wrists: true, hips: true });
  assert.ok(Math.abs(a.shoulderWidth - 0.2 * 1280) < 1e-6);
  assert.ok(Math.abs(a.rollRad) < 1e-9);
  assert.equal(a.yawRad, 0);
  assert.ok(Math.abs(a.shoulderMid.x - 640) < 1e-6);
  assert.ok(Math.abs(a.torsoLength - 0.32 * 720) < 1);
});

test('analyzeUpperBody: hips hidden -> partial with an estimated torso and a hint', () => {
  const a = analyzeUpperBody(pose({ [LM.L_HIP]: { visibility: 0.1 }, [LM.R_HIP]: { visibility: 0.1 } }), VIEW);
  assert.equal(a.status, 'partial');
  assert.equal(a.torsoEstimated, true);
  assert.ok(a.hints.includes('hips_hidden'));
  assert.ok(Math.abs(a.torsoLength - a.shoulderWidth * 1.3) < 1e-6);
  assert.equal(a.visible.hips, false);
});

test('analyzeUpperBody: shoulder missing, low confidence or outside the frame -> none', () => {
  assert.equal(analyzeUpperBody(null, VIEW).reason, 'no_body');
  assert.equal(analyzeUpperBody([], VIEW).reason, 'no_body');
  assert.equal(analyzeUpperBody(pose({ [LM.L_SHOULDER]: { visibility: 0.2 } }), VIEW).reason, 'shoulders_hidden');
  assert.equal(analyzeUpperBody(pose({ [LM.R_SHOULDER]: { x: 1.4 } }), VIEW).status, 'none');
});

test('analyzeUpperBody: implausible hip detection falls back to the estimate', () => {
  const a = analyzeUpperBody(pose({ [LM.L_HIP]: { y: 0.31 }, [LM.R_HIP]: { y: 0.31 } }), VIEW); // hips almost at shoulder height
  assert.equal(a.torsoEstimated, true);
});

test('roll sign: lower right-hand (screen) shoulder gives a negative (clockwise) angle, regardless of mirroring', () => {
  const tilted = pose({ [LM.L_SHOULDER]: { y: 0.36 } }); // image-right shoulder lower
  assert.ok(analyzeUpperBody(tilted, VIEW).rollRad < -0.1);
  // mirrored view: the same physical pose appears with sides swapped on screen, so the screen-right shoulder is now the other one
  const mirroredTilt = analyzeUpperBody(tilted, { ...VIEW, mirrored: true });
  assert.ok(mirroredTilt.rollRad > 0.1, 'after mirroring, the lower shoulder is on the screen LEFT -> counter-clockwise');
});

test('yaw sign: screen-right shoulder further from the camera gives positive yaw; mirroring flips which landmark that is', () => {
  const turned = pose({ [LM.L_SHOULDER]: { z: 0.25 }, [LM.R_SHOULDER]: { z: -0.25 } });
  assert.ok(analyzeUpperBody(turned, VIEW).yawRad > 0.1);
  assert.ok(analyzeUpperBody(turned, { ...VIEW, mirrored: true }).yawRad < -0.1);
  const slight = pose({ [LM.L_SHOULDER]: { z: 0.005 }, [LM.R_SHOULDER]: { z: -0.005 } }); // ~3 degrees of apparent depth: noise
  assert.equal(analyzeUpperBody(slight, VIEW).yawRad, 0, 'dead zone removes depth noise');
  const extreme = pose({ [LM.L_SHOULDER]: { z: 5 }, [LM.R_SHOULDER]: { z: -5 } });
  assert.ok(analyzeUpperBody(extreme, VIEW).yawRad <= 0.6 + 1e-9, 'limited');
});

test('distance hints', () => {
  const far = pose({ [LM.L_SHOULDER]: { x: 0.53 }, [LM.R_SHOULDER]: { x: 0.47 } });
  assert.ok(analyzeUpperBody(far, VIEW).hints.includes('too_far'));
  const close = pose({ [LM.L_SHOULDER]: { x: 0.95 }, [LM.R_SHOULDER]: { x: 0.05 } });
  assert.ok(analyzeUpperBody(close, VIEW).hints.includes('too_close'));
  assert.deepEqual(analyzeUpperBody(pose(), VIEW).hints, []);
});

test('OneEuroFilter: removes small jitter but follows a real step quickly', () => {
  const f = new OneEuroFilter();
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  let rawVar = 0; let outVar = 0; let n = 0;
  for (let i = 0; i < 300; i += 1) {
    const noisy = 0.5 + rnd() * 0.006; // +-0.3% of the frame width
    const out = f.filter(noisy, 1 / 30);
    if (i > 30) { rawVar += (noisy - 0.5) ** 2; outVar += (out - 0.5) ** 2; n += 1; }
  }
  assert.ok(outVar / n < (rawVar / n) * 0.35, 'jitter strongly reduced');
  let v = 0.5; // a fast move of 25% of the width
  for (let i = 0; i < 6; i += 1) v = f.filter(0.75, 1 / 30);
  assert.ok(v > 0.7, `follows the step within ~200ms (got ${v.toFixed(3)})`);
});

test('PoseSmoother: tracking -> holding (garment stays) -> lost (hidden); resets after a long gap and when the stage resizes', () => {
  const s = new PoseSmoother();
  const box = { boxW: 1280, boxH: 720 };
  const good = analyzeUpperBody(pose(), VIEW);
  const bad = analyzeUpperBody(pose({ [LM.L_SHOULDER]: { visibility: 0 } }), VIEW);
  let t = 1000;
  let r = s.update(good, t, box);
  assert.equal(r.state, 'tracking');
  assert.ok(Math.abs(r.pose.x - 640) < 1e-6, 'first sample passes through unfiltered');
  t += 100; r = s.update(bad, t, box);
  assert.equal(r.state, 'holding'); assert.ok(r.pose, 'last pose kept');
  t += HOLD_MS; r = s.update(bad, t, box);
  assert.equal(r.state, 'lost'); assert.equal(r.pose, null);
  assert.equal(r.reason, 'shoulders_hidden');
  // reappear far away after a long gap: no smoothing across the jump
  const moved = analyzeUpperBody(pose({ [LM.L_SHOULDER]: { x: 0.9 }, [LM.R_SHOULDER]: { x: 0.7 } }), VIEW);
  t += 3000; r = s.update(moved, t, box);
  assert.ok(Math.abs(r.pose.x - 0.8 * 1280) < 1e-6, 'snaps to the new position');
  // resize resets
  r = s.update(good, t + 33, { boxW: 720, boxH: 1280 });
  assert.equal(r.state, 'tracking');
});

test('PoseSmoother: does not jump when a pose appears at a new place for one frame only (spike is damped)', () => {
  const s = new PoseSmoother();
  const box = { boxW: 1280, boxH: 720 };
  let t = 0;
  for (let i = 0; i < 20; i += 1) { t += 33; s.update(analyzeUpperBody(pose(), VIEW), t, box); }
  const spike = analyzeUpperBody(pose({ [LM.L_SHOULDER]: { x: 0.7 }, [LM.R_SHOULDER]: { x: 0.5 } }), VIEW); // +0.1 w
  t += 33; const r = s.update(spike, t, box);
  assert.ok(Math.abs(r.pose.x - 640) < 0.1 * 1280 * 0.6, 'a single-frame spike moves the garment by far less than the spike');
});

test('computePlacement: garment types use different profiles; adjustments apply; offset > 0 moves down', () => {
  const p = { x: 500, y: 200, shoulderWidth: 200, torsoLength: 260, rollRad: 0.1, yawRad: 0 };
  const top = computePlacement(p, { garmentType: 'top' });
  const coat = computePlacement(p, { garmentType: 'outerwear' });
  assert.ok(coat.targetWidth > top.targetWidth && coat.maxHeight > top.maxHeight);
  assert.deepEqual(top.pivot, { x: 500, y: 200 });
  assert.equal(top.rollRad, 0.1);
  const big = computePlacement(p, { garmentType: 'top', scaleAdjust: 1.2 });
  assert.ok(Math.abs(big.targetWidth - top.targetWidth * 1.2) < 1e-9);
  const down = computePlacement(p, { garmentType: 'top', offsetYAdjust: 0.1 });
  assert.ok(down.topLocalY < top.topLocalY, 'topLocalY is +up, so moving down lowers it');
  assert.deepEqual(computePlacement(p, { garmentType: 'unknown' }).targetWidth, top.targetWidth, 'unknown type uses the safe default');
});

test('fitGarment keeps proportions: width-limited vs length-limited', () => {
  const wide = fitGarment(1, 1, { targetWidth: 300, maxHeight: 1000 });
  assert.deepEqual([wide.width, wide.height], [300, 300]);
  const longCoat = fitGarment(1, 3, { targetWidth: 300, maxHeight: 600 });
  assert.deepEqual([longCoat.width, longCoat.height], [200, 600]);
  assert.equal(fitGarment(0, 1, { targetWidth: 1, maxHeight: 1 }).scale, 0);
});

test('guidanceFor gives helpful, specific messages', () => {
  assert.match(guidanceFor({ state: 'lost', reason: 'no_body', hints: [] }), /Step into the picture/);
  assert.match(guidanceFor({ state: 'lost', reason: 'shoulders_hidden', hints: [] }), /both shoulders/);
  assert.match(guidanceFor({ state: 'tracking', reason: null, hints: ['hips_hidden'] }), /hips/);
  assert.match(guidanceFor({ state: 'tracking', reason: null, hints: ['too_far'] }), /closer/);
  assert.equal(guidanceFor({ state: 'tracking', reason: null, hints: [] }), null);
});
