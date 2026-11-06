import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCustomizationService } from '../src/modules/ai/sessions/customization.service.js';
import { createChatService } from '../src/modules/ai/chat/chat.service.js';
import { ProviderError, PROVIDER_ERROR as E } from '../src/modules/ai/providers/errors.js';

const png = (w = 800, h = 1000, tag = 0) => {
  const b = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[36] = tag;
  return b;
};
const DESC = (id) => ({ id, label: id, operator: id, privacyUrl: 'https://x', model: 'm', disclosure: [] });
const CFG = {
  uploadTypes: ['image/jpeg', 'image/png', 'image/webp'], maxUploadBytes: 8 << 20, minSide: 256, maxSessionsPerUser: 3, maxVersionsPerSession: 5, maxSavedPerUser: 2,
  maxMessageChars: 600, historyTurns: 10, editTimeoutMs: 240_000, unsavedRetentionDays: 7, savedRetentionDays: 90,
  editUserHourlyLimit: 3, editUserDailyLimit: 5, editStoreDailyCap: 0,
};

function makeEnv({ chatAnswers = [], imageBehaviour, product = null, has3d = false } = {}) {
  let clock = 1_700_000_000_000;
  let seq = 0; let uuid = 0;
  const S = { sessions: [], versions: [], messages: [], saved: [] };
  const files = new Map();
  const storage = {
    files,
    async save(kind, buf) { const k = `${kind}-${files.size + 1}`; files.set(`${kind}/${k}`, buf); return k; },
    async read(kind, key) { const b = files.get(`${kind}/${key}`); if (!b) throw new Error('missing'); return b; },
    async remove(kind, key) { files.delete(`${kind}/${key}`); },
  };
  const next = () => (seq += 1);
  const repo = {
    S,
    async getSessionById(id) { return S.sessions.find((s) => s.id === id) || null; },
    async getSessionOwned(pid, uid) { return S.sessions.find((s) => s.public_id === pid && s.user_id === uid) || null; },
    async findLatestForProduct(uid, pid) { return [...S.sessions].reverse().find((s) => s.user_id === uid && s.product_id === pid) || null; },
    async listSessionsForUser(uid) { return S.sessions.filter((s) => s.user_id === uid).map((s) => ({ ...s, version_count: 0, saved_count: 0 })); },
    async countSessionsForUser(uid) { return S.sessions.filter((s) => s.user_id === uid).length; },
    async listAllSessionsForUser(uid) { return S.sessions.filter((s) => s.user_id === uid); },
    async insertSessionLimited(r, max) {
      if (S.sessions.filter((s) => s.user_id === r.userId).length >= max) return { limit: true };
      const row = { id: next(), public_id: r.publicId, user_id: r.userId, session_type: r.type, product_id: r.productId, product_name: r.productName, product_slug: r.productSlug, title: r.title, visible_view: r.visibleView, status: 'active',
        original_key: r.originalKey, original_mime: r.originalMime, original_width: r.originalWidth, original_height: r.originalHeight, current_version_id: null, expires_at: r.expiresAt, created_at: r.now, updated_at: r.now };
      S.sessions.push(row); return { id: row.id };
    },
    async setCurrentVersion({ sessionId, versionId }) { (await this.getSessionById(sessionId)).current_version_id = versionId; },
    async touchSession() {},
    async deleteSession(id) { S.sessions = S.sessions.filter((s) => s.id !== id); S.versions = S.versions.filter((v) => v.session_id !== id); S.messages = S.messages.filter((m) => m.session_id !== id); },
    async listMessages(sid) { return S.messages.filter((m) => m.session_id === sid); },
    async insertMessage(m) {
      if (m.requestId && S.messages.some((x) => x.session_id === m.sessionId && x.client_request_id === m.requestId)) return { duplicate: true };
      const row = { id: next(), session_id: m.sessionId, sender_type: m.sender, message: m.message, structured_instruction: m.structured, status: m.status || 'completed', error_code: m.errorCode || null, version_id: m.versionId, client_request_id: m.requestId, created_at: m.now };
      S.messages.push(row); return { id: row.id };
    },
    async failMessagesForVersion(vid, code) { for (const m of S.messages) if (m.version_id === vid && m.sender_type === 'assistant') { m.status = 'failed'; m.error_code = code; } },
    async getVersionById(id) { return S.versions.find((v) => v.id === id) || null; },
    async getVersionInSession(sid, pid) { return S.versions.find((v) => v.session_id === sid && v.public_id === pid) || null; },
    async listVersions(sid) { return S.versions.filter((v) => v.session_id === sid); },
    async hasChildren(id) { return S.versions.some((v) => v.parent_version_id === id); },
    async hasProcessingInSession(sid) { return S.versions.some((v) => v.session_id === sid && v.status === 'processing'); },
    async findProcessingForUser(uid) { return S.versions.find((v) => v.status === 'processing' && v.image_requested && S.sessions.find((s) => s.id === v.session_id).user_id === uid) || null; },
    async insertVersion(r, { exclusive, maxVersions }) {
      if (exclusive && await this.findProcessingForUser(r.userId)) return { conflict: true };
      const mine = S.versions.filter((v) => v.session_id === r.sessionId);
      if (mine.length >= maxVersions) return { limit: true };
      const row = { id: next(), public_id: r.publicId, session_id: r.sessionId, parent_version_id: r.parentVersionId, version_number: mine.length + 1, status: r.status, image_requested: r.imageRequested ? 1 : 0, edit_instruction: r.instruction,
        structured_changes: r.structuredChanges, config_3d: r.config3d, output_key: null, provider: r.provider, model: r.model, created_at: r.now };
      S.versions.push(row); return { id: row.id, versionNumber: row.version_number };
    },
    async markVersionCompleted({ id, output, provider, model }) { const v = S.versions.find((x) => x.id === id && x.status === 'processing'); if (!v) return false; Object.assign(v, { status: 'completed', output_key: output.key, output_mime: output.mime, output_width: output.width, output_height: output.height, provider, model }); return true; },
    async markVersionFailed({ id, errorCode, providerErrorCode }) { const v = S.versions.find((x) => x.id === id && x.status === 'processing'); if (!v) return false; Object.assign(v, { status: 'failed', error_code: errorCode, provider_error_code: providerErrorCode }); return true; },
    async deleteVersion(id) { S.versions = S.versions.filter((v) => v.id !== id); },
    async failStale() { return 0; },
    async countImageRequestsSince({ userId }) { return S.versions.filter((v) => v.image_requested && S.sessions.find((s) => s.id === v.session_id).user_id === userId).length; },
    async collectKeys(sid) { return S.versions.filter((v) => v.session_id === sid && v.output_key).map((v) => v.output_key); },
    async insertSaved(r) { S.saved.push({ id: next(), public_id: r.publicId, user_id: r.userId, session_id: r.sessionId, version_id: r.versionId, design_id: r.designId, title: r.title, created_at: r.now }); return 1; },
    async countSavedForUser(uid) { return S.saved.filter((s) => s.user_id === uid).length; },
    async getSavedByVersion(vid) { return S.saved.find((s) => s.version_id === vid) || null; },
    async getSavedOwned(pid, uid) { return S.saved.find((s) => s.public_id === pid && s.user_id === uid) || null; },
    async countSavedInSession(sid) { return S.saved.filter((s) => s.session_id === sid).length; },
    async listSavedForSession(sid) { return S.saved.filter((s) => s.session_id === sid); },
    async listSavedForUser(uid) { return S.saved.filter((s) => s.user_id === uid).map((s) => { const v = S.versions.find((x) => x.id === s.version_id); const se = S.sessions.find((x) => x.id === s.session_id); return { ...s, session_public_id: se.public_id, session_type: se.session_type, product_slug: se.product_slug, product_name: se.product_name, version_public_id: v.public_id, version_number: v.version_number, has_image: !!v.output_key, config_3d: v.config_3d }; }); },
    async deleteSaved(id) { S.saved = S.saved.filter((s) => s.id !== id); },
    async listExpiredSessions() { return []; },
  };

  const calls = { chat: [], image: [] };
  const chatProvider = {
    id: 'fakechat', isConfigured: () => true, configIssue: () => null, describe: () => DESC('fakechat'),
    async understandInstruction(req) { calls.chat.push(req); const a = chatAnswers.shift(); if (a instanceof Error) throw a; return { data: a, model: 'cm' }; },
    generateResponse: async () => ({ text: '' }),
  };
  const imageProvider = {
    id: 'fakeimage', isConfigured: () => true, configIssue: () => null, describe: () => DESC('fakeimage'),
    async editImage(req) { calls.image.push(req); const r = imageBehaviour ? await imageBehaviour(req, calls.image.length) : { image: { buffer: png(900, 1200, calls.image.length), mimeType: 'image/png' }, model: 'im' }; return r; },
  };
  const providers = { chat: chatProvider, image: imageProvider, tryon: { describe: () => DESC('t'), isConfigured: () => true }, isReady: (k) => (k === 'chat' ? chatProvider : k === 'image' ? imageProvider : { isConfigured: () => true }).isConfigured(), summary: () => ({}), supported: () => ({}) };
  const tasks = [];
  const productSource = {
    async get(id) { return product && id === product.id ? product : null; },
    async getOptions() { return [{ key: 'sleeve', label: 'Sleeve', values: [{ key: 'long', label: 'Long' }, { key: 'short', label: 'Short' }] }]; },
    async flags() { return { has3d, tryOnEligible: false, arEligible: false }; },
    async loadImage() { return png(); },
  };
  const designs = [];
  const svc = createCustomizationService({
    repo, storage, chat: createChatService({ getChatProvider: () => chatProvider }), providers, productSource, config: { ...CFG }, arService: {},
    sign: (w, id, uid) => `/api/ai/assets/${w}/${id}?u=${uid}`, createDesign: async (uid, d) => { designs.push(d); return { id: 77 }; }, deleteDesign: async () => {},
    schedule: (fn) => tasks.push(fn), logger: { warn() {}, error() {}, log() {} }, now: () => clock, newId: () => `00000000-0000-4000-8000-${String((uuid += 1)).padStart(12, '0')}`,
  });
  const drain = async () => { while (tasks.length) await tasks.shift()(); };
  return { svc, S, repo, storage, calls, drain, designs, advance: (ms) => { clock += ms; } };
}

const U1 = { id: 1 }; const U2 = { id: 2 };
const answer = (o) => ({ reply: 'Sure.', intent: 'edit', imageEdit: { instruction: 'Change the shirt to dark purple', targetsUnseenView: false }, operations3d: [], unsupported: [], ...o });
async function start(env, user = U1) {
  const cfg = await env.svc.getConfig();
  return env.svc.createSession({ user, type: 'upload', title: 'white shirt', viewHint: 'front', consent: true, consentVersion: cfg.consent.version, image: { buffer: png() } });
}
const msg = (env, id, text, user = U1, requestId) => env.svc.sendMessage(user, id, { message: text, requestId: requestId || crypto.randomUUID() });

test('upload session needs consent, a valid image and a garment title; the original is stored untouched', async () => {
  const env = makeEnv();
  const cfg = await env.svc.getConfig();
  const base = { user: U1, type: 'upload', title: 'white shirt', consentVersion: cfg.consent.version, image: { buffer: png() } };
  await assert.rejects(() => env.svc.createSession({ ...base, consent: false }), (e) => e.status === 400);
  await assert.rejects(() => env.svc.createSession({ ...base, consent: true, consentVersion: 'old' }), (e) => e.status === 400);
  await assert.rejects(() => env.svc.createSession({ ...base, consent: true, image: { buffer: Buffer.from('not an image at all') } }), (e) => e.status === 400);
  await assert.rejects(() => env.svc.createSession({ ...base, consent: true, image: { buffer: png(100, 100) } }), (e) => e.status === 400);
  await assert.rejects(() => env.svc.createSession({ ...base, consent: true, title: 'x' }), (e) => e.status === 400);
  const { session, resumed } = await env.svc.createSession({ ...base, consent: true });
  assert.equal(resumed, false);
  assert.equal(session.previewIsOriginal, true);
  assert.equal(session.messages.length, 0, 'no fabricated messages');
  assert.equal(env.storage.files.size, 1);
  assert.ok(!JSON.stringify(session).includes('original-1'), 'storage keys never reach the client');
});

test('iterative editing: first edit uses the original, the second uses the previous generated version', async () => {
  const env = makeEnv({ chatAnswers: [answer({}), answer({ imageEdit: { instruction: 'Make the dragon smaller', targetsUnseenView: false } })] });
  const { session } = await start(env);
  let out = await msg(env, session.id, 'Change the shirt to dark purple');
  assert.equal(out.session.busy, true);
  assert.equal(out.session.versions[0].status, 'processing');
  await env.drain();
  assert.equal(env.calls.image.length, 1);
  assert.deepEqual(env.calls.image[0].image.buffer, png(), 'first edit input is the original');
  assert.match(env.calls.image[0].prompt, /dark purple/);
  assert.match(env.calls.image[0].prompt, /Change only what was asked/);
  out = await env.svc.getSession(U1, session.id);
  assert.equal(out.versions[0].status, 'completed');
  assert.equal(out.currentVersionId, out.versions[0].id);
  assert.equal(out.previewIsOriginal, false);
  const firstOutput = env.S.versions[0].output_key;

  await msg(env, session.id, 'Make the dragon smaller');
  await env.drain();
  assert.equal(env.calls.image.length, 2);
  assert.deepEqual(env.calls.image[1].image.buffer, await env.storage.read('versions', firstOutput), 'second edit input is version 1');
  out = await env.svc.getSession(U1, session.id);
  assert.equal(out.versions.length, 2);
  assert.equal(out.versions[1].parentId, out.versions[0].id);
  assert.equal(env.storage.files.size, 3, 'original + two versions; the original is never overwritten');
});

test('a failed edit keeps the last successful preview and shows a normalized, customer-safe error', async () => {
  let n = 0;
  const env = makeEnv({
    chatAnswers: [answer({}), answer({})],
    imageBehaviour: async (req) => { n += 1; if (n === 2) throw new ProviderError(E.QUOTA_EXCEEDED, { providerCode: 'CF_4006', providerMessage: 'secret provider text' }); return { image: { buffer: png(900, 1200, 1), mimeType: 'image/png' }, model: 'im' }; },
  });
  const { session } = await start(env);
  await msg(env, session.id, 'purple'); await env.drain();
  const good = (await env.svc.getSession(U1, session.id)).currentVersionId;
  await msg(env, session.id, 'more'); await env.drain();
  const out = await env.svc.getSession(U1, session.id);
  assert.equal(out.versions[1].status, 'failed');
  assert.equal(out.currentVersionId, good, 'head stays on the last successful version');
  assert.equal(out.versions[1].error.code, E.QUOTA_EXCEEDED);
  assert.ok(!JSON.stringify(out).includes('secret provider text'));
  assert.equal(out.messages.at(-1).status, 'failed');
  assert.equal(env.calls.image.length, 2, 'no automatic retry');
  assert.equal(out.busy, false);
});

test('duplicate request id never creates a second message, version or paid call', async () => {
  const env = makeEnv({ chatAnswers: [answer({}), answer({})] });
  const { session } = await start(env);
  const rid = crypto.randomUUID();
  await msg(env, session.id, 'purple', U1, rid);
  await msg(env, session.id, 'purple', U1, rid).catch(() => {});
  await env.drain();
  assert.equal(env.calls.image.length, 1);
  assert.equal(env.S.versions.length, 1);
  assert.equal(env.calls.chat.length, 1);
});

test('only one generation at a time per customer; sending while one runs is refused before any provider call', async () => {
  const env = makeEnv({ chatAnswers: [answer({}), answer({})] });
  const { session } = await start(env);
  await msg(env, session.id, 'purple');
  await assert.rejects(() => msg(env, session.id, 'again'), (e) => e.status === 409);
  assert.equal(env.calls.chat.length, 1);
});

test('unseen-view requests are refused without calling the image provider', async () => {
  const env = makeEnv({ chatAnswers: [answer({ imageEdit: { instruction: 'Add a golden dragon', targetsUnseenView: false } })] });
  const { session } = await start(env);
  const out = await msg(env, session.id, 'Add a golden dragon graphic on the back');
  await env.drain();
  assert.equal(env.calls.image.length, 0);
  assert.equal(out.session.versions.length, 0);
  assert.match(out.session.messages.at(-1).text, /can only edit what is visible/);
});

test('a question creates no version; chat failure is shown as a failed assistant message, not a fake answer', async () => {
  const env = makeEnv({ chatAnswers: [{ reply: 'Cotton.', intent: 'question', imageEdit: null }, new ProviderError(E.RATE_LIMITED)] });
  const { session } = await start(env);
  let out = await msg(env, session.id, 'what fabric is it?');
  assert.equal(out.session.versions.length, 0);
  assert.equal(out.session.messages.at(-1).text, 'Cotton.');
  out = await msg(env, session.id, 'purple');
  const last = out.session.messages.at(-1);
  assert.equal(last.status, 'failed');
  assert.equal(last.error.code, E.RATE_LIMITED);
  assert.equal(env.calls.image.length, 0);
});

test('per-customer edit limits stop generation before the provider is called', async () => {
  const env = makeEnv({ chatAnswers: Array.from({ length: 6 }, () => answer({})) });
  const { session } = await start(env);
  for (let i = 0; i < 3; i += 1) { await msg(env, session.id, `edit ${i}`); await env.drain(); }
  const out = await msg(env, session.id, 'one more');
  await env.drain();
  assert.equal(env.calls.image.length, 3);
  assert.match(out.session.messages.at(-1).text, /limit of 3 image edits per hour/);
});

test('restore an earlier version, delete rules, and save / list / delete a design', async () => {
  const env = makeEnv({ chatAnswers: [answer({}), answer({})] });
  const { session } = await start(env);
  await msg(env, session.id, 'a'); await env.drain();
  await msg(env, session.id, 'b'); await env.drain();
  let s = await env.svc.getSession(U1, session.id);
  const [v1, v2] = s.versions;
  s = await env.svc.restoreVersion(U1, session.id, v1.id);
  assert.equal(s.currentVersionId, v1.id);
  await assert.rejects(() => env.svc.deleteVersion(U1, session.id, v1.id), (e) => e.status === 409, 'v2 builds on v1');
  const saved = await env.svc.saveVersion(U1, session.id, { versionId: v1.id, title: 'Purple' });
  assert.equal(saved.title, 'Purple');
  await assert.rejects(() => env.svc.deleteVersion(U1, session.id, v1.id), (e) => e.status === 409);
  s = await env.svc.deleteVersion(U1, session.id, v2.id);
  assert.equal(s.versions.length, 1);
  assert.equal((await env.svc.listSaved(U1)).length, 1);
  s = await env.svc.restoreOriginal(U1, session.id);
  assert.equal(s.previewIsOriginal, true);
  await env.svc.deleteSaved(U1, saved.id);
  assert.equal((await env.svc.listSaved(U1)).length, 0);
});

test('ownership: another customer sees nothing and can change nothing', async () => {
  const env = makeEnv({ chatAnswers: [answer({})] });
  const { session } = await start(env);
  await msg(env, session.id, 'a'); await env.drain();
  const vid = (await env.svc.getSession(U1, session.id)).versions[0].id;
  const nf = (e) => e.status === 404;
  await assert.rejects(() => env.svc.getSession(U2, session.id), nf);
  await assert.rejects(() => msg(env, session.id, 'x', U2), nf);
  await assert.rejects(() => env.svc.restoreVersion(U2, session.id, vid), nf);
  await assert.rejects(() => env.svc.saveVersion(U2, session.id, { versionId: vid }), nf);
  await assert.rejects(() => env.svc.deleteSession(U2, session.id), nf);
  await assert.rejects(() => env.svc.getTryOnMethods(U2, session.id), nf);
  assert.deepEqual(await env.svc.listSessions(U2), []);
});

test('deleting a session removes the original and every generated file', async () => {
  const env = makeEnv({ chatAnswers: [answer({})] });
  const { session } = await start(env);
  await msg(env, session.id, 'a'); await env.drain();
  assert.equal(env.storage.files.size, 2);
  await env.svc.deleteSession(U1, session.id);
  assert.equal(env.storage.files.size, 0);
  assert.equal(env.S.sessions.length, 0);
});

test('session cap per customer', async () => {
  const env = makeEnv();
  for (let i = 0; i < 3; i += 1) await start(env);
  await assert.rejects(() => start(env), (e) => e.status === 429);
  assert.equal(env.storage.files.size, 3, 'the rejected upload left no orphan file');
});

test('product session: product facts come from the database, 3D operations are validated and saved with a 3D design', async () => {
  const product = { id: 5, name: 'Linen Shirt', slug: 'linen-shirt', description: 'desc', price: '1999', status: 'active', primaryImage: '/uploads/products/x.jpg', has3d: true, variants: [{ size: 'M', colorName: 'White', inStock: true }, { size: 'XL', colorName: 'White', inStock: false }] };
  const env = makeEnv({ product, has3d: true, chatAnswers: [answer({ imageEdit: null, intent: 'edit', operations3d: [{ type: 'set_color', key: 'burgundy' }, { type: 'set_material', key: 'chainmail' }, { type: 'set_option', key: 'sleeve', value: 'short' }] })] });
  const cfg = await env.svc.getConfig();
  const { session } = await env.svc.createSession({ user: U1, type: 'product', productId: 5, consent: true, consentVersion: cfg.consent.version });
  assert.equal(session.product.has3d, true);
  assert.deepEqual(session.product.sizes, [{ size: 'M', inStock: true }, { size: 'XL', inStock: false }]);
  const again = await env.svc.createSession({ user: U1, type: 'product', productId: 5, consent: false, consentVersion: '' });
  assert.equal(again.resumed, true, 'resumes the product session without asking again');
  assert.equal(again.session.id, session.id);
  const out = await msg(env, session.id, 'burgundy with chainmail and short sleeves');
  assert.equal(env.calls.image.length, 0, '3D-only change needs no image provider');
  assert.match(env.calls.chat[0].system, /Sizes currently in stock.*M/);
  assert.ok(!/XL/.test(env.calls.chat[0].system));
  assert.deepEqual(out.session.config3d, { colorKey: 'burgundy', materialKey: null, options: { sleeve: 'short' } });
  assert.match(out.session.messages.at(-1).text, /chainmail/);
  const saved = await env.svc.saveVersion(U1, session.id, { title: 'Burgundy' });
  assert.equal(saved.designId, 77);
  assert.deepEqual(env.designs[0].config, { colorKey: 'burgundy', materialKey: null, options: { sleeve: 'short' } });
  const t = await env.svc.getTryOnMethods(U1, session.id);
  assert.deepEqual(t.methods.filter((m) => m.available).map((m) => m.id), ['studio_3d']);
});
