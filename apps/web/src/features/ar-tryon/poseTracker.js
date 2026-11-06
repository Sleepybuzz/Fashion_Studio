/**
 * MediaPipe Pose Landmarker loader. The library is imported lazily, so shoppers who never open AR do not download it.
 * Files are served from this site when present (run `npm run setup:ar`, see README) and fall back to the official
 * public hosts otherwise. Only the model/wasm files are downloaded from there; no camera data is ever sent to anyone:
 * inference runs on the customer's device.
 *
 * Speed notes:
 *  - `prefetchTrackingAssets()` can be called early (e.g. on the AR intro screen) so the files are ready before the camera is.
 *  - Source probing and the model download are done once per page load and cached (a retry or GPU->CPU fallback never re-downloads).
 *  - One throw-away detection is run at start-up so shader/model compilation does not hit the first live frame.
 */
const BASE = import.meta.env.BASE_URL || '/';
const WASM_VERSION = '1.2.2'; // keep in sync with @mediapipe/tasks-vision in package.json
const PROBE_TIMEOUT_MS = 2500;
// Optional: VITE_AR_DELEGATE=CPU (or GPU) to force one backend. Default: GPU, falling back to CPU.
const FORCED_DELEGATE = String(import.meta.env.VITE_AR_DELEGATE || '').toUpperCase();
const SOURCES = {
  wasm: [
    import.meta.env.VITE_MEDIAPIPE_WASM_URL,
    `${BASE}mediapipe/wasm`,
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${WASM_VERSION}/wasm`,
  ].filter(Boolean),
  model: [
    import.meta.env.VITE_MEDIAPIPE_MODEL_URL,
    `${BASE}mediapipe/models/pose_landmarker_lite.task`,
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  ].filter(Boolean),
};

/** True when the URL answers with a real file (a dev server answers missing files with index.html and status 200). */
async function exists(url, probeSuffix = '') {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url + probeSuffix, { method: 'HEAD', signal: ctl.signal });
    return res.ok && !/text\/html/i.test(res.headers.get('content-type') || '');
  } catch { return false; } finally { clearTimeout(timer); }
}

/** All candidates are probed at once; the highest-priority one that answers wins (so a missing local copy costs one timeout, not three). */
async function firstAvailable(list, probeSuffix) {
  const probes = list.map((u) => exists(u, probeSuffix));
  for (let i = 0; i < list.length; i += 1) if (await probes[i]) return list[i];
  return null;
}

/** Download a file while reporting 0..1. Returns the bytes, or null on any problem. */
async function fetchBytes(url, onFraction, fallbackSize) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const total = Number(res.headers.get('content-length')) || fallbackSize;
    if (!res.body?.getReader) { const all = new Uint8Array(await res.arrayBuffer()); onFraction(1); return all; }
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      onFraction(Math.min(0.99, got / total));
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    onFraction(1);
    return out;
  } catch { return null; }
}

// ---- loading progress (0..100) that the UI can show
let progress = { pct: 0, label: 'Preparing…' };
const listeners = new Set();
function report(pct, label) {
  progress = { pct: Math.round(pct), label: label || progress.label };
  listeners.forEach((fn) => fn(progress));
}
/** Calls fn immediately and on every change. Returns an unsubscribe function. */
export function subscribeTrackerProgress(fn) {
  listeners.add(fn);
  fn(progress);
  return () => listeners.delete(fn);
}

const MODEL_BYTES = 5.5e6; // rough sizes, only used when the server sends no Content-Length
const WASM_BYTES = 9.6e6;

let assetsPromise = null;
function loadAssets() {
  if (!assetsPromise) {
    report(0, 'Preparing…');
    assetsPromise = (async () => {
      const [lib, wasmBase, modelUrl] = await Promise.all([
        import('@mediapipe/tasks-vision').then((m) => { report(8, 'Finding tracking files…'); return m; }),
        firstAvailable(SOURCES.wasm, '/vision_wasm_internal.wasm'),
        firstAvailable(SOURCES.model, ''),
      ]);
      if (!wasmBase || !modelUrl) throw new Error('Tracking files could not be downloaded');
      report(12, 'Downloading tracking files…');
      let m = 0; let w = 0;
      const update = () => report(12 + 63 * ((m * MODEL_BYTES + w * WASM_BYTES) / (MODEL_BYTES + WASM_BYTES)), 'Downloading tracking files…');
      // The wasm file is fetched here only to warm the browser cache (and to measure progress); MediaPipe then reads it from the cache.
      const [modelBytes] = await Promise.all([
        fetchBytes(modelUrl, (f) => { m = f; update(); }, MODEL_BYTES),
        fetchBytes(`${wasmBase}/vision_wasm_internal.wasm`, (f) => { w = f; update(); }, WASM_BYTES),
      ]);
      report(76, 'Unpacking…');
      const fileset = await lib.FilesetResolver.forVisionTasks(wasmBase);
      return { lib, fileset, modelUrl, modelBytes };
    })().catch((err) => { assetsPromise = null; throw err; }); // a failed attempt can be retried
  }
  return assetsPromise;
}

/** Start downloading the tracking library, wasm and model in the background. Safe to call many times; never throws. */
export function prefetchTrackingAssets() {
  loadAssets().catch(() => { /* surfaced later by createPoseTracker */ });
}

/**
 * @returns {Promise<{detect:(video:HTMLVideoElement)=>Array|null, close:()=>void, delegate:'GPU'|'CPU'}>}
 * @throws {Error} with `.code = 'tracker_init'`
 */
export async function createPoseTracker() {
  try {
    const { lib, fileset, modelUrl, modelBytes } = await loadAssets();
    report(80, 'Starting body tracking…');
    const { PoseLandmarker } = lib;

    let landmarker = null;
    let delegate = 'GPU';
    let lastErr;
    const order = FORCED_DELEGATE === 'CPU' || FORCED_DELEGATE === 'GPU' ? [FORCED_DELEGATE] : ['GPU', 'CPU']; // GPU is much faster; CPU is the fallback
    for (const d of order) {
      try {
        landmarker = await PoseLandmarker.createFromOptions(fileset, {
          // slice(): every attempt gets its own copy of the already downloaded model
          baseOptions: modelBytes ? { modelAssetBuffer: modelBytes.slice(), delegate: d } : { modelAssetPath: modelUrl, delegate: d },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        delegate = d;
        break;
      } catch (err) { lastErr = err; }
    }
    if (!landmarker) throw lastErr || new Error('Pose model could not be created');
    report(95, 'Warming up…');

    let lastTs = 0;
    try { // warm-up: compiles shaders / initialises buffers now instead of on the first live frame
      const c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      lastTs = performance.now();
      landmarker.detectForVideo(c, lastTs);
    } catch { /* warm-up is optional */ }
    report(100, 'Ready');

    return {
      delegate,
      /** Landmarks of the first detected person, or null. Timestamps must increase strictly for VIDEO mode. */
      detect(video) {
        const ts = Math.max(performance.now(), lastTs + 1);
        lastTs = ts;
        const result = landmarker.detectForVideo(video, ts);
        return result?.landmarks?.[0] || null;
      },
      close() { try { landmarker.close(); } catch { /* already closed */ } },
    };
  } catch (err) {
    const e = new Error(err?.message || 'Body tracking could not be started');
    e.code = 'tracker_init';
    throw e;
  }
}