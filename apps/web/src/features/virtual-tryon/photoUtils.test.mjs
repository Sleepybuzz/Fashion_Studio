import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, checkPickedFile } from './photoUtils.js';

test('fitWithin scales down by the longest side and never upscales', () => {
  assert.deepEqual(fitWithin(4000, 3000, 2048), { width: 2048, height: 1536 });
  assert.deepEqual(fitWithin(3000, 4000, 2048), { width: 1536, height: 2048 });
  assert.deepEqual(fitWithin(800, 600, 2048), { width: 800, height: 600 });
});

test('checkPickedFile explains unsupported files', () => {
  assert.match(checkPickedFile({ type: 'image/heic', name: 'a.heic', size: 1 }), /HEIC/);
  assert.match(checkPickedFile({ type: 'application/pdf', name: 'a.pdf', size: 1 }), /JPEG, PNG or WebP/);
  assert.match(checkPickedFile({ type: 'image/jpeg', name: 'a.jpg', size: 50 * 1024 * 1024 }), /too large/);
  assert.equal(checkPickedFile({ type: 'image/png', name: 'a.png', size: 1000 }), null);
});
