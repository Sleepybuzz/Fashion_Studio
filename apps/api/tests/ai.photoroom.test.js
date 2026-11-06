import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoroomAdapter, mapPhotoroomError, configFromEnv } from '../src/modules/ai/providers/image/photoroom.adapter.js';
import { createImageProvider } from '../src/modules/ai/providers/image/image-provider.factory.js';
import { PROVIDER_ERROR as E, ProviderError } from '../src/modules/ai/providers/errors.js';

const png = (w = 800, h = 1000) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
};
const pr = (fetchImpl, over = {}) => createPhotoroomAdapter({ apiKey: 'sandbox_k', baseUrl: 'https://pr.test', timeoutMs: 1000, ...over }, { fetchImpl });
const okImage = (buf) => async () => ({ ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });
const fail = (status, body) => async () => ({ ok: false, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

test('photoroom: sends multipart with Edit With AI fields and key in header only', async () => {
  let seen;
  const a = pr(async (url, init) => { seen = { url, init }; return okImage(png())(); });
  const out = await a.editImage({ image: { buffer: png(), mimeType: 'image/png' }, prompt: 'Change the shoes color to red', seed: 7 });
  assert.equal(seen.url, 'https://pr.test/v2/edit');
  assert.equal(seen.init.headers['x-api-key'], 'sandbox_k');
  assert.ok(!seen.init.headers['Content-Type']);
  const f = seen.init.body;
  assert.equal(f.get('editWithAI.mode'), 'ai.auto');
  assert.equal(f.get('editWithAI.prompt'), 'Change the shoes color to red');
  assert.equal(f.get('editWithAI.seed'), '7');
  assert.equal(f.get('removeBackground'), 'false');
  assert.equal(f.get('referenceBox'), 'originalImage');
  assert.ok(f.get('imageFile') instanceof Blob);
  assert.equal(out.image.mimeType, 'image/png');
  assert.equal(a.describe().testMode, true);
});

test('photoroom: not configured without key; errors are normalized and never retried', async () => {
  assert.match(pr(null, { apiKey: '' }).configIssue(), /PHOTOROOM_API_KEY/);
  await assert.rejects(() => pr(null, { apiKey: '' }).editImage({ image: { buffer: png() }, prompt: 'x' }), (e) => e.code === E.NOT_CONFIGURED);
  assert.equal(mapPhotoroomError(401, { detail: 'Invalid API key' }), E.NOT_CONFIGURED);
  assert.equal(mapPhotoroomError(402, {}), E.QUOTA_EXCEEDED);
  assert.equal(mapPhotoroomError(429, { detail: 'rate limit' }), E.RATE_LIMITED);
  assert.equal(mapPhotoroomError(400, { detail: 'Invalid image format' }), E.INVALID_PHOTO);
  assert.equal(mapPhotoroomError(500, null), E.UNAVAILABLE);
  let calls = 0;
  const a = pr(async () => { calls += 1; return fail(503, 'down')(); });
  await assert.rejects(() => a.editImage({ image: { buffer: png() }, prompt: 'x' }), (e) => e instanceof ProviderError && e.code === E.UNAVAILABLE);
  assert.equal(calls, 1);
});

test('photoroom: non-image 200 answer, network error and timeout are clear failures', async () => {
  await assert.rejects(() => pr(okImage(Buffer.from('{"oops":1}'))).editImage({ image: { buffer: png() }, prompt: 'x' }), (e) => e.code === E.GENERATION_FAILED);
  await assert.rejects(() => pr(async () => { throw new TypeError('fetch failed'); }).editImage({ image: { buffer: png() }, prompt: 'x' }), (e) => e.code === E.UNAVAILABLE);
  await assert.rejects(() => pr(async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }).editImage({ image: { buffer: png() }, prompt: 'x' }), (e) => e.code === E.TIMEOUT);
});

test('photoroom: selectable by IMAGE_EDIT_PROVIDER, env parsing', () => {
  const p = createImageProvider('photoroom', { PHOTOROOM_API_KEY: ' sandbox_abc ' });
  assert.equal(p.id, 'photoroom');
  assert.equal(p.isConfigured(), true);
  assert.equal(configFromEnv({}).baseUrl, 'https://image-api.photoroom.com');
});
