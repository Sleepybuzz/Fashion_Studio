import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makePng, fakeJpeg } from './helpers/images.js';

process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.DB_USER = 'nobody';

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/config/db.js');
const { imageHasAlpha } = await import('../src/modules/ar/ar.alpha.js');
const { createCaptureSchema, adminConfigSchema } = await import('../src/modules/ar/ar.schemas.js');
const { AR_CONSENT_VERSION } = await import('../src/modules/ar/ar.constants.js');
const { validateImage } = await import('../src/modules/tryon/image.inspect.js');
const { createTryOnStorage } = await import('../src/modules/tryon/tryon.storage.js');
const { deriveSigningKey, signAsset, verifyAsset } = await import('../src/modules/tryon/signing.js');
const fs = await import('node:fs/promises');
const os = await import('node:os');
const path = await import('node:path');

let server;
let base;
before(() => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); await pool.end().catch(() => {}); });

// ------------------------------------------------------------------ alpha detection
test('imageHasAlpha: PNG RGBA is transparent-capable, opaque RGB is not', () => {
  assert.equal(imageHasAlpha(makePng(64, 64, { alpha: true }), 'image/png'), true);
  assert.equal(imageHasAlpha(makePng(64, 64, { alpha: false }), 'image/png'), false);
});

test('imageHasAlpha: palette PNG only counts with a tRNS chunk before the pixel data', () => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const mk = (withTrns) => {
    const ihdr = Buffer.alloc(25); ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(8, 8); ihdr.writeUInt32BE(8, 12); ihdr[16] = 8; ihdr[17] = 3;
    const trns = Buffer.alloc(13); trns.writeUInt32BE(1, 0); trns.write('tRNS', 4, 'latin1');
    const idat = Buffer.alloc(12); idat.writeUInt32BE(0, 0); idat.write('IDAT', 4, 'latin1');
    return Buffer.concat([sig, ihdr, ...(withTrns ? [trns] : []), idat]);
  };
  assert.equal(imageHasAlpha(mk(true), 'image/png'), true);
  assert.equal(imageHasAlpha(mk(false), 'image/png'), false);
});

test('imageHasAlpha: WebP VP8X flag, VP8L bit and plain lossy', () => {
  const head = (kind) => { const b = Buffer.alloc(40); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write(kind, 12, 'latin1'); return b; };
  const x = head('VP8X'); x[20] = 0x10;
  assert.equal(imageHasAlpha(x, 'image/webp'), true);
  assert.equal(imageHasAlpha(head('VP8X'), 'image/webp'), false);
  const l = head('VP8L'); l[20] = 0x2f; l.writeUInt32LE(1 << 28, 21);
  assert.equal(imageHasAlpha(l, 'image/webp'), true);
  const l2 = head('VP8L'); l2[20] = 0x2f;
  assert.equal(imageHasAlpha(l2, 'image/webp'), false);
  assert.equal(imageHasAlpha(head('VP8 '), 'image/webp'), false);
  assert.equal(imageHasAlpha(fakeJpeg(300, 300), 'image/jpeg'), false);
});

// ------------------------------------------------------------------ schemas
test('createCaptureSchema requires consent and the current consent version, and validates the customization snapshot', () => {
  const ok = createCaptureSchema.safeParse({ productId: '7', consent: 'true', consentVersion: AR_CONSENT_VERSION, config: JSON.stringify({ colorKey: 'navy', options: { sleeves: 'short' } }) });
  assert.equal(ok.success, true);
  assert.equal(ok.data.productId, 7);
  assert.deepEqual(ok.data.config, { colorKey: 'navy', materialKey: null, options: { sleeves: 'short' } });
  assert.equal(createCaptureSchema.safeParse({ productId: '7', consentVersion: AR_CONSENT_VERSION }).success, false, 'consent missing');
  assert.equal(createCaptureSchema.safeParse({ productId: '7', consent: 'false', consentVersion: AR_CONSENT_VERSION }).success, false, 'consent false');
  assert.equal(createCaptureSchema.safeParse({ productId: '7', consent: 'true', consentVersion: 'old' }).success, false, 'stale consent text');
  assert.equal(createCaptureSchema.safeParse({ productId: '7', consent: 'true', consentVersion: AR_CONSENT_VERSION, config: '{bad' }).success, false);
  assert.equal(createCaptureSchema.safeParse({ productId: '7', consent: 'true', consentVersion: AR_CONSENT_VERSION, config: 'x'.repeat(2000) }).success, false);
  assert.equal(createCaptureSchema.safeParse({ productId: 'x', consent: 'true', consentVersion: AR_CONSENT_VERSION }).success, false);
  assert.equal(createCaptureSchema.safeParse({ productId: '7', consent: 'true', consentVersion: AR_CONSENT_VERSION }).data.config, null);
});

test('adminConfigSchema bounds the calibration knobs and rejects unknown garment types / modes', () => {
  const base = { enabled: true, garmentType: 'top', assetMode: 'model3d', scaleAdjust: 1, offsetYAdjust: 0 };
  assert.equal(adminConfigSchema.safeParse(base).success, true);
  assert.equal(adminConfigSchema.safeParse({ ...base, garmentType: 'trousers' }).success, false);
  assert.equal(adminConfigSchema.safeParse({ ...base, assetMode: 'video' }).success, false);
  assert.equal(adminConfigSchema.safeParse({ ...base, scaleAdjust: 3 }).success, false);
  assert.equal(adminConfigSchema.safeParse({ ...base, offsetYAdjust: -1 }).success, false);
  assert.equal(adminConfigSchema.safeParse({ ...base, scaleAdjust: 1.234 }).data.scaleAdjust, 1.23);
});

// ------------------------------------------------------------------ storage + signing reuse
test('AR storage uses its own kinds, random names, and refuses anything else', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'afs-ar-'));
  try {
    const st = createTryOnStorage(dir, ['captures', 'overlays']);
    const key = await st.save('captures', makePng(8, 8), 'png');
    assert.match(key, /^[0-9a-f-]{36}\.png$/);
    assert.equal((await st.read('captures', key)).length > 0, true);
    await assert.rejects(() => st.save('photos', Buffer.from('x'), 'png'), /Unknown storage kind/);
    assert.equal(await st.remove('captures', '../../etc/passwd'), false);
    assert.equal(await st.remove('captures', key), true);
    assert.equal(await st.remove('captures', key), false);
    // the default (Phase 3) kinds are unchanged
    assert.equal(createTryOnStorage(dir).dirFor('photos').endsWith('photos'), true);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('capture signatures bind kind, id, customer and expiry', () => {
  const key = deriveSigningKey('test-secret-test-secret-test-secret-123456');
  const id = '3f2b8a3e-0000-4000-8000-000000000000';
  const { exp, u, sig } = signAsset(key, { kind: 'arcapture', id, userId: 5, ttlSeconds: 60 });
  assert.equal(verifyAsset(key, { kind: 'arcapture', id, exp, u, sig }), true);
  assert.equal(verifyAsset(key, { kind: 'arcapture', id, exp, u: 6, sig }), false, 'other customer');
  assert.equal(verifyAsset(key, { kind: 'result', id, exp, u, sig }), false, 'a Phase 3 signature kind cannot be replayed');
  assert.equal(verifyAsset(key, { kind: 'arcapture', id, exp, u, sig, nowMs: (exp + 5) * 1000 }), false, 'expired');
});

test('capture images are validated by real content (dimensions, type)', () => {
  const lim = { minSide: 240, maxSide: 4096, maxPixels: 16_000_000, maxBytes: 4 * 1024 * 1024 };
  assert.equal(validateImage(fakeJpeg(720, 1280), lim).mime, 'image/jpeg');
  assert.throws(() => validateImage(fakeJpeg(100, 100), lim), /too small/);
  assert.throws(() => validateImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), lim), /Only JPEG, PNG or WebP/);
});

// ------------------------------------------------------------------ routes (no database needed)
test('customer AR endpoints that touch private data require authentication', async () => {
  const id = '3f2b8a3e-0000-4000-8000-000000000000';
  for (const [method, p] of [['GET', '/api/ar/captures'], ['POST', '/api/ar/captures'], ['DELETE', '/api/ar/captures'], ['DELETE', `/api/ar/captures/${id}`]]) {
    assert.equal((await fetch(base + p, { method })).status, 401, `${method} ${p}`);
  }
});

test('admin AR endpoints refuse unauthenticated requests', async () => {
  for (const [method, p] of [['GET', '/api/admin/ar/products'], ['GET', '/api/admin/ar/products/1'], ['PATCH', '/api/admin/ar/products/1'],
    ['PUT', '/api/admin/ar/products/1/overlay'], ['DELETE', '/api/admin/ar/products/1/overlay'], ['GET', '/api/admin/ar/products/1/overlay/file']]) {
    assert.equal((await fetch(base + p, { method })).status, 401, `${method} ${p}`);
  }
});

test('signed screenshot URLs reject malformed, forged and expired signatures without touching the database', async () => {
  const id = '3f2b8a3e-0000-4000-8000-000000000000';
  assert.equal((await fetch(`${base}/api/ar/assets/capture/not-a-uuid?exp=9999999999&u=1&sig=${'0'.repeat(64)}`)).status, 400);
  assert.equal((await fetch(`${base}/api/ar/assets/capture/${id}`)).status, 400);
  assert.equal((await fetch(`${base}/api/ar/assets/capture/${id}?exp=9999999999&u=1&sig=${'0'.repeat(64)}`)).status, 404);
  assert.equal((await fetch(`${base}/api/ar/assets/capture/${id}?exp=1&u=1&sig=${'a'.repeat(64)}`)).status, 404);
});
