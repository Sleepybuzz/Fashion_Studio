import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConstraints, classifyCameraError, evaluateSupport, isMirrored } from './cameraUtils.js';

test('classifyCameraError maps browser errors to recovery steps', () => {
  assert.equal(classifyCameraError({ name: 'NotAllowedError' }).code, 'permission_denied');
  assert.equal(classifyCameraError({ name: 'NotFoundError' }).code, 'no_camera');
  assert.equal(classifyCameraError({ name: 'NotReadableError' }).code, 'in_use');
  assert.equal(classifyCameraError({ name: 'SecurityError' }).code, 'insecure');
  assert.equal(classifyCameraError({ name: 'Whatever' }).code, 'unknown');
  assert.equal(classifyCameraError(null).code, 'unknown');
  assert.equal(classifyCameraError({ name: 'NotAllowedError' }, { isSecureContext: false }).code, 'insecure');
  for (const n of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'camera_lost']) {
    assert.ok(classifyCameraError({ name: n }).steps.length > 0, n);
  }
  assert.equal(classifyCameraError({ name: 'SecurityError' }).retryable, false);
});

test('evaluateSupport lists every missing capability', () => {
  assert.equal(evaluateSupport({ isSecureContext: true, hasMediaDevices: true, hasWebGL: true, hasWasm: true }).ok, true);
  const r = evaluateSupport({ isSecureContext: false, hasMediaDevices: false, hasWebGL: false, hasWasm: false });
  assert.deepEqual(r.problems.map((p) => p.code), ['insecure', 'no_media_devices', 'no_webgl', 'no_wasm']);
});

test('constraints prefer the requested camera without demanding it; mirroring follows the camera', () => {
  assert.deepEqual(buildConstraints('environment').video.facingMode, { ideal: 'environment' });
  assert.equal(buildConstraints('user').audio, false);
  assert.equal(isMirrored('user', 'environment'), true);
  assert.equal(isMirrored('environment', 'user'), false);
  assert.equal(isMirrored(undefined, 'user'), true);
  assert.equal(isMirrored(undefined, 'environment'), false);
});
