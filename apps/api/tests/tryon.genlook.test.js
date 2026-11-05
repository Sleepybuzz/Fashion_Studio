import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGenlookProvider, mapGenlookError } from '../src/modules/tryon/providers/genlook.provider.js';
import { assertProvider, ProviderError, PROVIDER_ERROR as E } from '../src/modules/tryon/providers/provider.contract.js';
import { createProvider } from '../src/modules/tryon/providers/index.js';

const cfg = { apiKey: 'gk_secret_key_123', baseUrl: 'https://api.genlook.app/tryon/v1/', keepForDays: 1, testMode: false, cropPhoto: false };
const json = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const img = (n) => ({ buffer: Buffer.from('img' + n), mimeType: 'image/jpeg', filename: `f${n}.jpg` });
const input = { externalUserId: 'afs-u5', photo: img(0), garment: { externalId: 'afs-p1-abc', title: 'Tee', description: 'A tee', images: [img(1), img(2)] } };

function fake(handlers) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const h = handlers.shift();
    if (!h) throw new Error('unexpected call ' + url);
    return typeof h === 'function' ? h(url, init) : h;
  };
  return { fn, calls };
}

test('implements the provider contract and reports a missing key without calling the network', async () => {
  const p = createGenlookProvider({ ...cfg, apiKey: '' }, { fetchImpl: async () => { throw new Error('network used'); } });
  assertProvider(p);
  assert.equal(p.isConfigured(), false);
  assert.match(p.configIssue(), /GENLOOK_API_KEY/);
  await assert.rejects(() => p.submitTryOn(input), (e) => e.code === E.NOT_CONFIGURED);
});

test('known product: upload, then reference by id (2 calls), auth header and options', async () => {
  const f = fake([json(201, { imageId: 'img-1' }), json(201, { generationId: 'gen-1', status: 'PENDING' })]);
  const p = createGenlookProvider(cfg, { fetchImpl: f.fn });
  assert.deepEqual(await p.submitTryOn(input), { jobId: 'gen-1' });
  assert.equal(f.calls[0].url, 'https://api.genlook.app/tryon/v1/images/upload');
  assert.equal(f.calls[0].init.headers['x-api-key'], cfg.apiKey);
  const form = f.calls[0].init.body;
  assert.equal(form.get('crop'), 'false'); assert.equal(form.get('keepForDays'), '1'); assert.equal(form.get('externalUserId'), 'afs-u5');
  const body = JSON.parse(f.calls[1].init.body);
  assert.deepEqual(body.products, [{ externalId: 'afs-p1-abc' }]);
  assert.deepEqual(body.person, { image: { source: { id: 'img-1' } } });
  assert.equal(body.mock, undefined);
});

test('unknown product: PRODUCT_NOT_FOUND triggers ONE inline multipart resend with garment bytes', async () => {
  const f = fake([
    json(201, { imageId: 'img-1' }),
    json(404, { code: 'PRODUCT_NOT_FOUND', message: 'nope', status: 404 }),
    json(201, { generationId: 'gen-2', status: 'PENDING' }),
  ]);
  const p = createGenlookProvider(cfg, { fetchImpl: f.fn });
  assert.deepEqual(await p.submitTryOn(input), { jobId: 'gen-2' });
  const form = f.calls[2].init.body;
  const data = JSON.parse(form.get('data'));
  assert.equal(data.products[0].title, 'Tee');
  assert.deepEqual(data.products[0].images, [{ source: { fileKey: 'garment0' } }, { source: { fileKey: 'garment1' } }]);
  assert.ok(form.get('garment0') instanceof Blob && form.get('garment1') instanceof Blob);
  assert.equal(f.calls.length, 3);
});

test('test mode sends the documented mock flag', async () => {
  const f = fake([json(201, { imageId: 'i' }), json(201, { generationId: 'g' })]);
  await createGenlookProvider({ ...cfg, testMode: true }, { fetchImpl: f.fn }).submitTryOn(input);
  assert.equal(JSON.parse(f.calls[1].init.body).mock, true);
});

test('the paid create call is NEVER retried, even on 500 or network failure', async () => {
  for (const failing of [json(500, { code: 'INTERNAL_ERROR' }), () => { throw new TypeError('fetch failed'); }]) {
    const f = fake([json(201, { imageId: 'i' }), failing]);
    await assert.rejects(() => createGenlookProvider(cfg, { fetchImpl: f.fn }).submitTryOn(input), (e) => e instanceof ProviderError && e.code === E.UNAVAILABLE);
    assert.equal(f.calls.length, 2, 'no second create call');
  }
});

test('the free upload step may be retried once on a transient failure', async () => {
  const f = fake([json(503, {}), json(201, { imageId: 'i' }), json(201, { generationId: 'g' })]);
  assert.deepEqual(await createGenlookProvider(cfg, { fetchImpl: f.fn }).submitTryOn(input), { jobId: 'g' });
  assert.equal(f.calls.length, 3);
});

test('error codes are normalized and never leak the key or provider text', async () => {
  const cases = [[402, 'INSUFFICIENT_CREDITS', E.INSUFFICIENT_CREDITS], [429, 'RATE_LIMITED', E.RATE_LIMITED], [401, 'INVALID_API_KEY', E.NOT_CONFIGURED],
    [400, 'UNSUPPORTED_IMAGE_TYPE', E.INVALID_PHOTO], [422, 'CONTENT_POLICY_VIOLATION', E.CONTENT_POLICY]];
  for (const [status, code, expected] of cases) {
    const f = fake([json(status, { code, message: 'secret detail gk_secret_key_123' })]);
    const err = await createGenlookProvider(cfg, { fetchImpl: f.fn }).submitTryOn(input).catch((e) => e);
    assert.equal(err.code, expected);
    assert.equal(err.message, expected);
    assert.ok(!JSON.stringify(err).includes('gk_secret_key_123') || err.providerMessage, 'only internal providerMessage may carry text');
    assert.ok(!err.message.includes('gk_'));
  }
  assert.equal(mapGenlookError(undefined, 503), E.UNAVAILABLE);
  assert.equal(mapGenlookError('SOMETHING_NEW', 400), E.GENERATION_FAILED);
});

test('status mapping: pending, processing, completed, failed, completed-without-url', async () => {
  const run = async (body) => createGenlookProvider(cfg, { fetchImpl: fake([json(200, body)]).fn }).getStatus('gen/1');
  assert.equal((await run({ status: 'PENDING' })).state, 'pending');
  assert.equal((await run({ status: 'PROCESSING' })).state, 'processing');
  assert.deepEqual(await run({ status: 'COMPLETED', resultImageUrl: 'https://x/y.png' }), { state: 'completed', resultUrl: 'https://x/y.png' });
  const failed = await run({ status: 'FAILED', errorCode: 'MISSING_REQUIRED_CLASSIFICATION' });
  assert.equal(failed.state, 'failed'); assert.equal(failed.errorCode, E.INVALID_GARMENT); assert.equal(failed.providerErrorCode, 'MISSING_REQUIRED_CLASSIFICATION');
  assert.equal((await run({ status: 'COMPLETED' })).state, 'failed');
});

test('status URL encodes the id; delete and credits use the documented paths', async () => {
  const f = fake([json(200, { status: 'PENDING' }), json(204, null), json(200, { creditBalance: 42 })]);
  const p = createGenlookProvider(cfg, { fetchImpl: f.fn });
  await p.getStatus('a/b');
  await p.deleteUserData('afs-u5');
  assert.deepEqual(await p.getCredits(), { balance: 42 });
  assert.equal(f.calls[0].url, 'https://api.genlook.app/tryon/v1/generations/a%2Fb');
  assert.equal(f.calls[1].url, 'https://api.genlook.app/tryon/v1/customers/afs-u5');
  assert.equal(f.calls[1].init.method, 'DELETE');
  assert.equal(f.calls[2].url, 'https://api.genlook.app/tryon/v1/account/credits');
});

test('registry never falls back to a fake provider', async () => {
  const p = createProvider({ provider: 'does-not-exist' });
  assert.equal(p.isConfigured(), false);
  assert.match(p.configIssue(), /Unknown TRYON_PROVIDER/);
  await assert.rejects(() => p.submitTryOn(input), (e) => e.code === E.NOT_CONFIGURED);
  assert.equal(createProvider({ provider: 'genlook', genlook: cfg }).id, 'genlook');
});
