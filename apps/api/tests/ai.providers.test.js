import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiAdapter, mapGeminiError, extractJsonObject, configFromEnv as geminiEnv } from '../src/modules/ai/providers/chat/gemini.adapter.js';
import { createCloudflareAdapter, nearestAspectRatio, mapCloudflareError, configFromEnv as cfEnv } from '../src/modules/ai/providers/image/cloudflare.adapter.js';
import { createChatProvider } from '../src/modules/ai/providers/chat/chat-provider.factory.js';
import { createImageProvider } from '../src/modules/ai/providers/image/image-provider.factory.js';
import { createProviderRegistry } from '../src/modules/ai/providers/provider-registry.js';
import { PROVIDER_ERROR as E, ProviderError } from '../src/modules/ai/providers/errors.js';

const png = (w = 800, h = 1000) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
};
const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });
const gem = (fetchImpl, over = {}) => createGeminiAdapter({ apiKey: 'k', model: 'm1', baseUrl: 'https://g.test/v1', timeoutMs: 1000, ...over }, { fetchImpl });
const cf = (fetchImpl, over = {}, deps = {}) => createCloudflareAdapter({ accountId: 'acc', apiToken: 'tok', model: 'black-forest-labs/flux-1-kontext-pro', baseUrl: 'https://cf.test/v4', timeoutMs: 1000, ...over }, { fetchImpl, ...deps });

test('gemini: sends key in header only, parses JSON answer, never puts the key in the URL', async () => {
  let seen;
  const a = gem(async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n{"reply":"hi"}\n```' }] } }], usageMetadata: { promptTokenCount: 5 } }) }; });
  const out = await a.understandInstruction({ system: 's', messages: [{ role: 'user', text: 'x' }, { role: 'assistant', text: 'y' }] });
  assert.deepEqual(out.data, { reply: 'hi' });
  assert.equal(seen.url, 'https://g.test/v1/models/m1:generateContent');
  assert.equal(seen.init.headers['x-goog-api-key'], 'k');
  assert.ok(!seen.url.includes('k=') );
  const body = JSON.parse(seen.init.body);
  assert.equal(body.contents[1].role, 'model');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
});

test('gemini: not configured without key or model; errors are normalized', async () => {
  assert.match(gem(null, { apiKey: '' }).configIssue(), /GEMINI_API_KEY/);
  assert.match(gem(null, { model: '' }).configIssue(), /GEMINI_CHAT_MODEL/);
  await assert.rejects(() => gem(null, { apiKey: '' }).generateResponse({ messages: [] }), (e) => e.code === E.NOT_CONFIGURED);
  assert.equal(mapGeminiError(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota' } }), E.QUOTA_EXCEEDED);
  assert.equal(mapGeminiError(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Too many requests' } }), E.RATE_LIMITED);
  assert.equal(mapGeminiError(400, { error: { message: 'API key not valid' } }), E.NOT_CONFIGURED);
  const a = gem(reply(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } }));
  await assert.rejects(() => a.generateResponse({ messages: [{ role: 'user', text: 'x' }] }), (e) => e instanceof ProviderError && e.code === E.QUOTA_EXCEEDED);
});

test('gemini: retries a transient failure once but never a quota error; blocked prompt is a content-policy error', async () => {
  let calls = 0;
  const flaky = gem(async () => { calls += 1; return calls === 1 ? { ok: false, status: 503, json: async () => ({ error: { status: 'UNAVAILABLE' } }) } : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) }; });
  assert.equal((await flaky.generateResponse({ messages: [{ role: 'user', text: 'x' }] })).text, 'ok');
  assert.equal(calls, 2);
  calls = 0;
  const quota = gem(async () => { calls += 1; return { ok: false, status: 429, json: async () => ({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } }) }; });
  await assert.rejects(() => quota.generateResponse({ messages: [{ role: 'user', text: 'x' }] }));
  assert.equal(calls, 1);
  const blocked = gem(reply(200, { promptFeedback: { blockReason: 'SAFETY' } }));
  await assert.rejects(() => blocked.generateResponse({ messages: [{ role: 'user', text: 'x' }] }), (e) => e.code === E.CONTENT_POLICY);
  await assert.rejects(() => gem(reply(200, { candidates: [{ content: { parts: [{ text: 'not json' }] } }] })).understandInstruction({ messages: [{ role: 'user', text: 'x' }] }), (e) => e.code === E.GENERATION_FAILED);
});

test('gemini helpers: JSON extraction and env parsing', () => {
  assert.deepEqual(extractJsonObject('noise {"a":1} tail'), { a: 1 });
  assert.equal(extractJsonObject('[1]'), null);
  assert.equal(geminiEnv({}).model, '');
  assert.equal(geminiEnv({ GEMINI_CHAT_MODEL: ' x ' }).model, 'x');
});

test('cloudflare: sends model + input_image base64 with bearer token; accepts a URL result and downloads it once', async () => {
  let seen; let downloads = 0;
  const out = png(900, 1200);
  const a = cf(async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ state: 'Completed', result: { image: 'https://img.test/x.png' } }) }; }, {}, { downloadImpl: async () => { downloads += 1; return out; } });
  const r = await a.editImage({ image: { buffer: png(), mimeType: 'image/png' }, prompt: 'p', size: { width: 800, height: 1000 } });
  assert.equal(seen.url, 'https://cf.test/v4/accounts/acc/ai/run');
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'black-forest-labs/flux-1-kontext-pro');
  assert.equal(body.input.input_image, png().toString('base64'));
  assert.equal(body.input.aspect_ratio, '4:5');
  assert.equal(downloads, 1);
  assert.equal(r.image.mimeType, 'image/png');
});

test('cloudflare: base64 result, async state, errors and no retry', async () => {
  const b64 = png(900, 1200).toString('base64');
  const ok = cf(reply(200, { success: true, result: { image: b64 } }));
  assert.ok((await ok.editImage({ image: { buffer: png(), mimeType: 'image/png' }, prompt: 'p' })).image.buffer.length > 0);
  const pending = cf(reply(200, { state: 'Pending', result: {} }));
  await assert.rejects(() => pending.editImage({ image: { buffer: png(), mimeType: 'image/png' }, prompt: 'p' }), (e) => e.providerCode === 'STATE_PENDING');
  let calls = 0;
  const down = cf(async () => { calls += 1; return { ok: false, status: 503, json: async () => ({}) }; });
  await assert.rejects(() => down.editImage({ image: { buffer: png(), mimeType: 'image/png' }, prompt: 'p' }), (e) => e.code === E.UNAVAILABLE);
  assert.equal(calls, 1, 'paid call is never retried');
  assert.equal(mapCloudflareError(429, { errors: [{ code: 4006, message: 'you have used up your daily free allocation of 10,000 neurons' }] }), E.QUOTA_EXCEEDED);
  assert.equal(mapCloudflareError(400, { errors: [{ message: 'Content moderated' }] }), E.CONTENT_POLICY);
  assert.equal(mapCloudflareError(401, {}), E.NOT_CONFIGURED);
  assert.match(cf(null, { accountId: '' }).configIssue(), /CLOUDFLARE_ACCOUNT_ID/);
  assert.equal(cfEnv({}).model, 'black-forest-labs/flux-1-kontext-pro');
  const notImg = cf(reply(200, { state: 'Completed', result: { image: Buffer.from('hello world, not an image').toString('base64') } }));
  await assert.rejects(() => notImg.editImage({ image: { buffer: png(), mimeType: 'image/png' }, prompt: 'p' }), (e) => e.providerCode === 'RESULT_NOT_AN_IMAGE');
});

test('cloudflare: nearest aspect ratio stays inside the documented range', () => {
  assert.equal(nearestAspectRatio({ width: 1000, height: 1000 }), '1:1');
  assert.equal(nearestAspectRatio({ width: 100, height: 1000 }), '3:7');
  assert.equal(nearestAspectRatio({ width: 3000, height: 1000 }), '7:3');
  assert.equal(nearestAspectRatio(undefined), '1:1');
});

test('factories reject unknown provider names with a clear message listing the implemented ones', () => {
  assert.throws(() => createChatProvider('openai', {}), /Unknown CHAT_AI_PROVIDER "openai".*gemini/);
  assert.throws(() => createImageProvider('huggingface', {}), /Unknown IMAGE_EDIT_PROVIDER "huggingface".*cloudflare/);
});

test('registry: capabilities are independent, missing keys are warnings, unknown names are fatal, never a fallback', () => {
  const tryon = { id: 'genlook', isConfigured: () => true, configIssue: () => null, describe: () => ({ label: 'Genlook', model: null }) };
  const base = { aiConfig: { chatProvider: 'gemini', imageProvider: 'cloudflare' }, tryon, tryonProviderName: 'genlook' };
  const r1 = createProviderRegistry({ ...base, envVars: {} });
  assert.equal(r1.fatalIssues().length, 0);
  assert.equal(r1.isReady('chat'), false);
  assert.equal(r1.isReady('image'), false);
  assert.ok(r1.issues.some((i) => i.capability === 'chat' && i.level === 'warn' && /GEMINI_API_KEY/.test(i.message)));
  const r2 = createProviderRegistry({ ...base, envVars: { GEMINI_API_KEY: 'a', GEMINI_CHAT_MODEL: 'm' } });
  assert.equal(r2.isReady('chat'), true);
  assert.equal(r2.isReady('image'), false, 'configuring chat must not configure image editing');
  assert.equal(r2.isReady('tryon'), true);
  const r3 = createProviderRegistry({ ...base, aiConfig: { chatProvider: 'nope', imageProvider: 'cloudflare' }, envVars: {} });
  assert.equal(r3.fatalIssues().length, 1);
  assert.match(r3.fatalIssues()[0].message, /Unknown CHAT_AI_PROVIDER "nope"/);
  assert.equal(r3.chat, null);
  assert.ok(!JSON.stringify(r2.summary()).includes('"a"'), 'summary never contains keys');
});
