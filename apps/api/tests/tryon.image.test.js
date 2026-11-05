import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectImageMime, validateImage, ImageValidationError } from '../src/modules/tryon/image.inspect.js';

const L = { minSide: 100, maxSide: 8000, maxPixels: 40_000_000 };

function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function jpeg(w, h, orientation) {
  const parts = [Buffer.from([0xff, 0xd8])];
  if (orientation) {
    const tiff = Buffer.alloc(26);
    tiff.write('MM', 0, 'latin1'); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4);
    tiff.writeUInt16BE(1, 8); tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(orientation, 18);
    const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const hdr = Buffer.from([0xff, 0xe1, 0, 0]); hdr.writeUInt16BE(app1.length + 2, 2);
    parts.push(hdr, app1);
  }
  const sof = Buffer.alloc(19);
  sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17, 2); sof[4] = 8; sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7);
  parts.push(sof, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}
function webpLossless(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(22, 4); b.write('WEBPVP8L', 8, 'latin1'); b.writeUInt32LE(10, 16);
  b[20] = 0x2f; b.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21);
  return b;
}
function webpExtended(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1'); b.write('WEBPVP8X', 8, 'latin1'); b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
}

test('reads PNG, JPEG and WebP dimensions from real headers', () => {
  assert.deepEqual([validateImage(png(640, 800), L).width, validateImage(png(640, 800), L).height], [640, 800]);
  const j = validateImage(jpeg(1200, 900), L);
  assert.equal(j.mime, 'image/jpeg'); assert.equal(j.width, 1200); assert.equal(j.height, 900);
  const w = validateImage(webpLossless(500, 700), L);
  assert.equal(w.mime, 'image/webp'); assert.equal(w.width, 500); assert.equal(w.height, 700);
  const x = validateImage(webpExtended(321, 654), L);
  assert.equal(x.width, 321); assert.equal(x.height, 654);
});

test('applies EXIF rotation to the reported (display) dimensions', () => {
  const r = validateImage(jpeg(1200, 900, 6), L);
  assert.equal(r.width, 900); assert.equal(r.height, 1200); assert.equal(r.orientation, 6);
  assert.equal(validateImage(jpeg(1200, 900, 1), L).width, 1200);
});

test('rejects wrong type, tiny, huge, oversized and empty files', () => {
  const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof ImageValidationError); return e.code; } return 'NO_ERROR'; };
  assert.equal(code(() => validateImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), L)), 'UNSUPPORTED_TYPE');
  assert.equal(code(() => validateImage(Buffer.from('GIF89a......'), L)), 'UNSUPPORTED_TYPE');
  assert.equal(code(() => validateImage(png(50, 400), L)), 'TOO_SMALL');
  assert.equal(code(() => validateImage(png(9000, 500), L)), 'TOO_BIG_DIMENSIONS');
  assert.equal(code(() => validateImage(png(6500, 6500), L)), 'TOO_BIG_DIMENSIONS');
  assert.equal(code(() => validateImage(png(640, 800), { ...L, maxBytes: 10 })), 'TOO_LARGE');
  assert.equal(code(() => validateImage(Buffer.alloc(0), L)), 'EMPTY');
  assert.equal(code(() => validateImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0]), L)), 'CORRUPT');
});

test('detectImageMime trusts bytes, not names', () => {
  assert.equal(detectImageMime(png(10, 10)), 'image/png');
  assert.equal(detectImageMime(Buffer.from('MZ\x90\x00 not an image at all')), null);
});
