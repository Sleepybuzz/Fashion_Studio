import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTryOnService, evaluateEligibility, buildGarmentSpec, buildConsent, externalUserIdFor } from '../src/modules/tryon/tryon.service.js';
import { createTryOnMaintenance } from '../src/modules/tryon/tryon.maintenance.js';
import { deriveSigningKey } from '../src/modules/tryon/signing.js';
import { ProviderError, PROVIDER_ERROR as E } from '../src/modules/tryon/providers/provider.contract.js';

// ---- helpers: a valid 800x1000 PNG header, fakes
function png(w = 800, h = 1000) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
const ACTIVE = ['validating', 'processing'];

function makeEnv(over = {}) {
  let clock = 1_700_000_000_000;
  const rows = [];
  let seq = 0;
  const files = new Map();
  const log = { warn() {}, error() {}, log() {} };
  const repo = {
    rows,
    async getById(id) { return rows.find((r) => r.id === id) || null; },
    async getOwned(pid, uid) { return rows.find((r) => r.public_id === pid && r.user_id === uid) || null; },
    async findActiveForUser(uid) { return rows.find((r) => r.user_id === uid && ACTIVE.includes(r.status)) || null; },
    async listForUser(uid) { const m = rows.filter((r) => r.user_id === uid); return { rows: m, total: m.length }; },
    async listAllForUser(uid) { return rows.filter((r) => r.user_id === uid); },
    async insertExclusive(r) {
      if (rows.some((x) => x.user_id === r.userId && ACTIVE.includes(x.status))) return { conflict: true };
      seq += 1;
      rows.push({ id: seq, public_id: r.publicId, user_id: r.userId, product_id: r.productId, product_name: r.productName, product_slug: r.productSlug,
        status: 'validating', provider: r.provider, provider_job_id: null, is_test: 0, attempts: 1, photo_key: r.photoKey, photo_mime: r.photoMime,
        result_key: null, result_mime: null, error_code: null, saved_at: null, expires_at: null, submitted_at: null, last_polled_at: null,
        completed_at: null, created_at: r.now });
      return { id: seq };
    },
    async resetForRetryExclusive({ id, userId }) {
      if (rows.some((x) => x.user_id === userId && ACTIVE.includes(x.status))) return { conflict: true };
      const r = rows.find((x) => x.id === id && x.status === 'failed');
      if (!r) return { conflict: true };
      Object.assign(r, { status: 'validating', attempts: r.attempts + 1, error_code: null, provider_job_id: null, submitted_at: null, last_polled_at: null, expires_at: null });
      return { ok: true };
    },
    async markProcessing({ id, jobId, isTest, now }) { const r = rows.find((x) => x.id === id && x.status === 'validating'); if (!r) return false; Object.assign(r, { status: 'processing', provider_job_id: jobId, is_test: isTest ? 1 : 0, submitted_at: now }); return true; },
    async markFailed({ id, errorCode, providerErrorCode, expiresAt }) { const r = rows.find((x) => x.id === id && ACTIVE.includes(x.status)); if (!r) return false; Object.assign(r, { status: 'failed', error_code: errorCode, provider_error_code: providerErrorCode, expires_at: expiresAt }); return true; },
    async markCompleted({ id, resultKey, resultMime, expiresAt, now }) { const r = rows.find((x) => x.id === id && x.status === 'processing'); if (!r) return false; Object.assign(r, { status: 'completed', result_key: resultKey, result_mime: resultMime, expires_at: expiresAt, completed_at: now }); return true; },
    async touchPolled(id, now) { rows.find((x) => x.id === id).last_polled_at = now; },
    async setSaved({ id, savedAt, expiresAt }) { Object.assign(rows.find((x) => x.id === id), { saved_at: savedAt, expires_at: expiresAt }); },
    async deleteById(id) { rows.splice(rows.findIndex((x) => x.id === id), 1); },
    async countCreatedSince({ since, userId }) { return rows.filter((r) => r.created_at >= since && (!userId || r.user_id === userId)).length; },
    async failStale({ cutoff, userId }) { let n = 0; for (const r of rows) if (ACTIVE.includes(r.status) && (!userId || r.user_id === userId) && (r.submitted_at || r.created_at) < cutoff) { r.status = 'failed'; r.error_code = 'TIMEOUT'; n += 1; } return n; },
    async listExpired(now) { return rows.filter((r) => r.expires_at && r.expires_at < now); },
    async overview() { return { total: rows.length }; },
  };
  const productData = { product: { id: 1, name: 'Linen Shirt', slug: 'linen-shirt', description: 'A shirt', status: 'active' }, config: { enabled: true, aiDescription: null }, images: [{ id: 1, storageKey: 'g1', mimeType: 'image/jpeg', sha256: 'aa' }] };
  const catalog = { data: productData, async getById(id) { return id === 1 ? this.data : null; }, async getBySlug(s) { return s === 'linen-shirt' ? this.data : null; } };
  const storage = {
    files,
    async save(kind, buf, ext) { const k = `${kind}-${files.size}.${ext}`; files.set(`${kind}/${k}`, buf); return k; },
    async read(kind, key) { if (kind === 'garments') return Buffer.from('garment'); const b = files.get(`${kind}/${key}`); if (!b) throw new Error('ENOENT'); return b; },
    async remove(kind, key) { return files.delete(`${kind}/${key}`); },
  };
  const calls = { submit: [], status: [], erase: [] };
  const provider = {
    id: 'genlook', configured: true, testMode: false, nextSubmit: async () => ({ jobId: 'job-1' }), nextStatus: async () => ({ state: 'processing' }),
    configIssue() { return this.configured ? null : 'GENLOOK_API_KEY is not set'; },
    isConfigured() { return this.configured; },
    describe() { return { id: 'genlook', label: 'Genlook', operator: 'Genlook (Parakeet Labs SASU, France)', privacyUrl: 'https://x', retentionDays: 1, testMode: this.testMode, disclosure: [] }; },
    async submitTryOn(i) { calls.submit.push(i); return this.nextSubmit(i); },
    async getStatus(j) { calls.status.push(j); return this.nextStatus(j); },
    async deleteUserData(u) { calls.erase.push(u); },
  };
  const config = {
    apiPrefix: '/api', consentTemplateVersion: 'v1', signingKey: deriveSigningKey('test-secret-test-secret-test-secret-12'),
    limits: { maxPhotoBytes: 8 * 1024 * 1024, userDailyLimit: 3, storeDailyCap: 5, processingTimeoutMs: 240_000, pollMinIntervalMs: 1500, signedUrlTtlSeconds: 1800 },
    retention: { unsavedDays: 7, savedDays: 90 },
    ...over,
  };
  const pending = [];
  const svc = createTryOnService({
    repo, catalog, provider, storage, config, logger: log, now: () => clock,
    downloadImage: async () => png(800, 1000),
    schedule: (fn) => pending.push(fn),
  });
  const runScheduled = async () => { while (pending.length) await pending.shift()(); };
  return { svc, repo, catalog, storage, provider, calls, config, runScheduled, advance: (ms) => { clock += ms; }, get now() { return clock; }, rows };
}
const user = { id: 5 };
const input = (over = {}) => ({ user, productId: 1, consent: true, consentVersion: 'v1-genlook', photo: { buffer: png() }, ...over });

test('consent is mandatory and nothing is stored or sent without it', async () => {
  const t = makeEnv();
  await assert.rejects(() => t.svc.createSession(input({ consent: false })), { status: 400 });
  await assert.rejects(() => t.svc.createSession(input({ consentVersion: 'v0-old' })), { status: 400 });
  assert.equal(t.rows.length, 0); assert.equal(t.storage.files.size, 0); assert.equal(t.calls.submit.length, 0);
});

test('unconfigured provider: clear 503, no row, no fake result', async () => {
  const t = makeEnv(); t.provider.configured = false;
  await assert.rejects(() => t.svc.createSession(input()), { status: 503 });
  assert.equal(t.rows.length, 0);
  assert.equal((await t.svc.getPublicConfig(user)).available, false);
});

test('ineligible products and invalid photos are rejected before any provider call', async () => {
  const t = makeEnv();
  t.catalog.data = { ...t.catalog.data, config: { enabled: false } };
  await assert.rejects(() => t.svc.createSession(input()), { status: 422 });
  t.catalog.data = { ...t.catalog.data, config: { enabled: true } };
  await assert.rejects(() => t.svc.createSession(input({ productId: 99 })), { status: 404 });
  await assert.rejects(() => t.svc.createSession(input({ photo: { buffer: Buffer.from('not an image at all, plain text') } })), { status: 400 });
  await assert.rejects(() => t.svc.createSession(input({ photo: { buffer: png(100, 100) } })), { status: 400 });
  assert.equal(t.rows.length, 0); assert.equal(t.storage.files.size, 0); assert.equal(t.calls.submit.length, 0);
});

test('happy path: validating -> processing -> completed, result stored privately, signed URLs only', async () => {
  const t = makeEnv();
  const created = await t.svc.createSession(input());
  assert.equal(created.status, 'validating');
  assert.equal(t.calls.submit.length, 0, 'submit runs in the background, after the response');
  await t.runScheduled();
  assert.equal(t.calls.submit.length, 1);
  assert.equal(t.calls.submit[0].externalUserId, externalUserIdFor(5));
  assert.equal(t.calls.submit[0].garment.images.length, 1);
  assert.match(t.calls.submit[0].garment.externalId, /^afs-p1-[0-9a-f]{12}$/);

  let v = await t.svc.getSession(user, created.id);
  assert.equal(v.status, 'processing'); assert.equal(v.resultUrl, null);

  t.provider.nextStatus = async () => ({ state: 'completed', resultUrl: 'https://cdn/result.png' });
  t.advance(2000);
  v = await t.svc.getSession(user, created.id);
  assert.equal(v.status, 'completed');
  assert.match(v.resultUrl, /^\/api\/tryon\/assets\/result\/[0-9a-f-]{36}\?exp=\d+&u=5&sig=[0-9a-f]{64}$/);
  assert.match(v.photoUrl, /\/assets\/photo\//);
  assert.ok([...t.storage.files.keys()].some((k) => k.startsWith('results/')));
  assert.ok(v.expiresAt, 'unsaved results get an expiry');
});

test('status polling is throttled and concurrent refreshes hit the provider once', async () => {
  const t = makeEnv();
  const c = await t.svc.createSession(input()); await t.runScheduled();
  t.advance(2000);
  await Promise.all([t.svc.getSession(user, c.id), t.svc.getSession(user, c.id), t.svc.getSession(user, c.id)]);
  assert.equal(t.calls.status.length, 1);
  await t.svc.getSession(user, c.id); // within 1.5s of the last poll
  assert.equal(t.calls.status.length, 1);
  t.advance(2000); await t.svc.getSession(user, c.id);
  assert.equal(t.calls.status.length, 2);
});

test('duplicate request protection: a second try-on while one is active is a 409 and leaves no file behind', async () => {
  const t = makeEnv();
  await t.svc.createSession(input());
  const filesBefore = t.storage.files.size;
  await assert.rejects(() => t.svc.createSession(input()), { status: 409 });
  assert.equal(t.storage.files.size, filesBefore);
  await t.runScheduled();
  assert.equal(t.calls.submit.length, 1, 'only one paid provider call');
});

test('provider errors become safe customer messages and the paid call is not repeated', async () => {
  const t = makeEnv();
  t.provider.nextSubmit = async () => { throw new ProviderError(E.INSUFFICIENT_CREDITS, { providerCode: 'INSUFFICIENT_CREDITS' }); };
  const c = await t.svc.createSession(input()); await t.runScheduled();
  const v = await t.svc.getSession(user, c.id);
  assert.equal(v.status, 'failed');
  assert.equal(v.error.code, E.INSUFFICIENT_CREDITS);
  assert.ok(!/credit|genlook|api/i.test(v.error.message), 'no provider/business internals shown to customers');
  assert.equal(t.calls.submit.length, 1);
});

test('async provider failure is recorded; invalid-photo failures are not retryable', async () => {
  const t = makeEnv();
  const c = await t.svc.createSession(input()); await t.runScheduled();
  t.provider.nextStatus = async () => ({ state: 'failed', errorCode: E.INVALID_PHOTO, providerErrorCode: 'INVALID_IMAGE' });
  t.advance(2000);
  const v = await t.svc.getSession(user, c.id);
  assert.equal(v.status, 'failed'); assert.equal(v.error.canRetry, false);
  await assert.rejects(() => t.svc.retrySession(user, c.id), { status: 409 });
});

test('manual retry works for transient failures, is capped at 3 attempts, and re-submits once', async () => {
  const t = makeEnv();
  t.provider.nextSubmit = async () => { throw new ProviderError(E.UNAVAILABLE); };
  const c = await t.svc.createSession(input()); await t.runScheduled();
  assert.equal((await t.svc.getSession(user, c.id)).error.canRetry, true);
  let v = await t.svc.retrySession(user, c.id); assert.equal(v.attempts, 2); await t.runScheduled();
  v = await t.svc.retrySession(user, c.id); assert.equal(v.attempts, 3); await t.runScheduled();
  assert.equal(t.calls.submit.length, 3);
  assert.equal((await t.svc.getSession(user, c.id)).error.canRetry, false);
  await assert.rejects(() => t.svc.retrySession(user, c.id), { status: 409 });
});

test('stuck sessions time out locally so they cannot block the customer forever', async () => {
  const t = makeEnv();
  const c = await t.svc.createSession(input()); await t.runScheduled();
  t.advance(241_000);
  const v = await t.svc.getSession(user, c.id);
  assert.equal(v.status, 'failed'); assert.equal(v.error.code, E.TIMEOUT);
  await t.svc.createSession(input()); // allowed again
});

test('ownership: another customer gets 404 for view, save, retry and delete', async () => {
  const t = makeEnv();
  const c = await t.svc.createSession(input()); await t.runScheduled();
  const other = { id: 6 };
  for (const fn of [() => t.svc.getSession(other, c.id), () => t.svc.setSaved(other, c.id, true), () => t.svc.retrySession(other, c.id), () => t.svc.deleteSession(other, c.id)]) {
    await assert.rejects(fn, { status: 404 });
  }
  await assert.rejects(() => t.svc.resolveSessionFile('photo', c.id, 6), { status: 404 });
  assert.equal((await t.svc.resolveSessionFile('photo', c.id, 5)).kind, 'photos');
  assert.equal((await t.svc.listSessions(other, { limit: 10, offset: 0 })).items.length, 0);
});

test('save extends retention, unsave restores it, only completed results can be saved; delete removes files', async () => {
  const t = makeEnv();
  const c = await t.svc.createSession(input()); await t.runScheduled();
  await assert.rejects(() => t.svc.setSaved(user, c.id, true), { status: 409 });
  await assert.rejects(() => t.svc.deleteSession(user, c.id), { status: 409 }); // still processing
  t.provider.nextStatus = async () => ({ state: 'completed', resultUrl: 'https://cdn/r.png' }); t.advance(2000);
  const done = await t.svc.getSession(user, c.id);
  const saved = await t.svc.setSaved(user, c.id, true);
  assert.equal(saved.saved, true);
  assert.ok(new Date(saved.expiresAt) - new Date(done.expiresAt) > 80 * 86400_000);
  assert.equal((await t.svc.setSaved(user, c.id, false)).saved, false);
  await t.svc.deleteSession(user, c.id);
  assert.equal(t.rows.length, 0); assert.equal(t.storage.files.size, 0);
});

test('delete all removes every try-on and asks the provider to erase the customer; refuses while one is active', async () => {
  const t = makeEnv();
  const c = await t.svc.createSession(input()); await t.runScheduled();
  await assert.rejects(() => t.svc.deleteAll(user), { status: 409 });
  t.provider.nextStatus = async () => ({ state: 'failed', errorCode: E.GENERATION_FAILED }); t.advance(2000);
  await t.svc.getSession(user, c.id);
  const out = await t.svc.deleteAll(user);
  assert.deepEqual(out, { deleted: 1, providerErased: true });
  assert.deepEqual(t.calls.erase, ['afs-u5']);
  assert.equal(t.storage.files.size, 0);
});

test('daily limits (per customer and store-wide) stop paid requests', async () => {
  const t = makeEnv();
  for (let i = 0; i < 3; i += 1) {
    const c = await t.svc.createSession(input()); await t.runScheduled();
    t.provider.nextStatus = async () => ({ state: 'failed', errorCode: E.GENERATION_FAILED }); t.advance(2000);
    await t.svc.getSession(user, c.id);
  }
  await assert.rejects(() => t.svc.createSession(input()), { status: 429 });
  const t2 = makeEnv({ limits: { maxPhotoBytes: 8e6, userDailyLimit: 0, storeDailyCap: 1, processingTimeoutMs: 240_000, pollMinIntervalMs: 1500, signedUrlTtlSeconds: 60 } });
  await t2.svc.createSession(input({ user: { id: 1 } }));
  await assert.rejects(() => t2.svc.createSession(input({ user: { id: 2 } })), { status: 429 });
});

test('maintenance deletes expired sessions with their files and fails stale ones', async () => {
  const t = makeEnv();
  const c = await t.svc.createSession(input()); await t.runScheduled();
  t.provider.nextStatus = async () => ({ state: 'completed', resultUrl: 'https://cdn/r.png' }); t.advance(2000);
  await t.svc.getSession(user, c.id);
  const m = createTryOnMaintenance({ repo: t.repo, storage: t.storage, config: t.config, logger: { warn() {} }, now: () => t.now });
  assert.equal((await m.run()).deleted, 0);
  t.advance(8 * 86400_000);
  assert.equal((await m.run()).deleted, 1);
  assert.equal(t.rows.length, 0); assert.equal(t.storage.files.size, 0);
});

test('pure helpers: eligibility, garment fingerprint, consent text', () => {
  const good = { product: { status: 'active' }, config: { enabled: true }, images: [{}] };
  assert.equal(evaluateEligibility(good).eligible, true);
  assert.equal(evaluateEligibility(null).reason, 'not_found');
  assert.equal(evaluateEligibility({ ...good, product: { status: 'draft' } }).reason, 'not_active');
  assert.equal(evaluateEligibility({ ...good, config: { enabled: false } }).reason, 'disabled');
  assert.equal(evaluateEligibility({ ...good, images: [] }).reason, 'no_images');
  const p = { id: 3, name: 'Tee', description: 'x' };
  const a = buildGarmentSpec(p, null, [{ sha256: '1' }]);
  assert.notEqual(a.externalId, buildGarmentSpec(p, null, [{ sha256: '2' }]).externalId, 'new photo => new provider product');
  assert.notEqual(a.externalId, buildGarmentSpec(p, { aiDescription: 'other' }, [{ sha256: '1' }]).externalId);
  const c = buildConsent({ id: 'genlook', label: 'Genlook', operator: 'Genlook (Parakeet Labs SASU, France)', retentionDays: 1, testMode: true, disclosure: ['d'] }, { templateVersion: 'v1', retention: { unsavedDays: 7, savedDays: 90 } });
  assert.equal(c.version, 'v1-genlook'); assert.match(c.points[0], /TEST MODE/); assert.match(c.checkboxLabel, /Parakeet Labs/);
});
