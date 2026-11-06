/** Pure camera helpers (no React) so error classification and support checks are unit-testable. */

/** @typedef {{code:string, title:string, message:string, steps?:string[], retryable:boolean}} CameraProblem */

/**
 * Turn a getUserMedia / MediaPipe-independent error into customer-friendly text with recovery steps.
 * @param {{name?:string}|null|undefined} err
 * @param {{isSecureContext?:boolean}} [ctx]
 * @returns {CameraProblem}
 */
export function classifyCameraError(err, ctx = {}) {
  const name = err?.name || '';
  if (ctx.isSecureContext === false || name === 'SecurityError') {
    return { code: 'insecure', retryable: false, title: 'Camera needs a secure connection',
      message: 'Browsers only allow camera access on HTTPS pages (or localhost while developing).',
      steps: ['Open the store using its https:// address.'] };
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return { code: 'permission_denied', retryable: true, title: 'Camera access was blocked',
      message: 'We need your permission to show the live preview. Nothing is recorded or uploaded.',
      steps: [
        'Tap the camera or lock icon next to the web address and choose “Allow” for the camera.',
        'On iPhone/iPad: Settings → Safari → Camera → Ask or Allow.',
        'Then press “Try again”.',
      ] };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return { code: 'no_camera', retryable: true, title: 'No camera found',
      message: 'We could not find a camera on this device.',
      steps: ['Connect or enable a camera, then press “Try again”.', 'Or try the AI Photo Try-On, which works with an uploaded photo.'] };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return { code: 'in_use', retryable: true, title: 'The camera is busy',
      message: 'Another app or browser tab may be using your camera.',
      steps: ['Close other apps or tabs that use the camera (video calls, other camera pages).', 'Then press “Try again”.'] };
  }
  if (name === 'camera_lost') {
    return { code: 'camera_lost', retryable: true, title: 'The camera stopped',
      message: 'The camera was disconnected or taken over by another app.', steps: ['Check the camera, then press “Try again”.'] };
  }
  return { code: 'unknown', retryable: true, title: 'The camera could not be started',
    message: 'Something went wrong while starting the camera.', steps: ['Press “Try again”. If it keeps failing, reload the page or try another browser.'] };
}

/**
 * Check browser capabilities before asking for the camera.
 * @param {{isSecureContext:boolean, hasMediaDevices:boolean, hasWebGL:boolean, hasWasm:boolean}} caps
 * @returns {{ok:boolean, problems:{code:string, message:string}[]}}
 */
export function evaluateSupport(caps) {
  const problems = [];
  if (!caps.isSecureContext) problems.push({ code: 'insecure', message: 'This page is not served over HTTPS, so the browser blocks the camera.' });
  if (!caps.hasMediaDevices) problems.push({ code: 'no_media_devices', message: 'This browser does not support camera access.' });
  if (!caps.hasWebGL) problems.push({ code: 'no_webgl', message: 'This browser or device does not support WebGL, which draws the garment.' });
  if (!caps.hasWasm) problems.push({ code: 'no_wasm', message: 'This browser does not support WebAssembly, which body tracking needs.' });
  return { ok: problems.length === 0, problems };
}

/** Read capabilities from the real browser. */
export function detectCapabilities() {
  let webgl = false;
  try {
    const c = document.createElement('canvas');
    webgl = !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { webgl = false; }
  return {
    isSecureContext: window.isSecureContext !== false,
    hasMediaDevices: !!navigator.mediaDevices?.getUserMedia,
    hasWebGL: webgl,
    hasWasm: typeof WebAssembly === 'object',
  };
}

/** Preferred stream constraints. 720p is plenty for pose tracking and keeps mobile devices cool. */
export function buildConstraints(facing) {
  return {
    audio: false,
    video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
  };
}

/** Selfie (user-facing) streams are mirrored; the rear camera is not. Desktop webcams report no facingMode and are treated as selfie. */
export function isMirrored(settingsFacingMode, requestedFacing) {
  if (settingsFacingMode) return settingsFacingMode === 'user';
  return requestedFacing === 'user';
}
