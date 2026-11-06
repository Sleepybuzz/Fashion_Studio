/**
 * End-to-end AR test against a REAL MySQL database and the real Express app (no mocks).
 * Skipped unless AFS_INTEGRATION=1, because it needs apps/api/.env with a migrated database and seeded accounts
 * (SEED_ADMIN_* / SEED_CUSTOMER_* in .env). It creates its own products and customer and removes them afterwards.
 * It writes uploads to a temporary folder, never to your real uploads directory.
 *   PowerShell:  $env:AFS_INTEGRATION="1"; npm test -w apps/api
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makePng, fakeJpeg } from './helpers/images.js';

const RUN = process.env.AFS_INTEGRATION === '1';
const opts = { skip: RUN ? false : 'set AFS_INTEGRATION=1 to run (needs a migrated MySQL database)' };

let app; let pool; let server; let base; let tmp; let env;
const tokens = {};
const state = {};

const j = async (res) => { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } };
const authed = (who, extra = {}) => ({ ...extra, headers: { ...(extra.headers || {}), Authorization: `Bearer ${tokens[who]}` } });
const form = (fields, files = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [k, [buf, type, name]] of Object.entries(files)) fd.append(k, new Blob([buf], { type }), name);
  return fd;
};
const login = async (email, password) => (await j(await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
}))).token;

before(async () => {
  if (!RUN) return;
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'afs-ar-int-'));
  process.env.UPLOAD_DIR = tmp; // absolute path: path.resolve keeps it
  process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret-123456';
  process.env.AR_MAX_CAPTURES_PER_USER = '5'; // small cap so the limit test is quick
  process.env.AR_CAPTURE_HOURLY_LIMIT = '200'; // keep the rate limiter out of the way of the cap test
  ({ env } = await import('../src/config/env.js'));
  ({ pool } = await import('../src/config/db.js'));
  ({ createApp: app } = await import('../src/app.js'));
  server = app().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  tokens.admin = await login(env.seed.adminEmail, env.seed.adminPassword);
  tokens.cust = await login(env.seed.customerEmail, env.seed.customerPassword);
  assert.ok(tokens.admin && tokens.cust, 'seeded admin and customer must exist (run npm run seed)');
  // a second customer to prove ownership checks
  const email = `ar-other-${Date.now()}@example.test`;
  const reg = await j(await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: 'Other Person', email, password: 'Other-Pass-123' }) }));
  tokens.other = reg.token; state.otherEmail = email;
});

after(async () => {
  if (!RUN) return;
  if (state.productIds?.length) await pool.query('DELETE FROM products WHERE id IN (?)', [state.productIds]);
  if (state.otherEmail) await pool.query('DELETE FROM users WHERE email = ?', [state.otherEmail]);
  await pool.query('DELETE FROM ar_captures WHERE user_id IN (SELECT id FROM users WHERE email = ?)', [env.seed.customerEmail]);
  server.close(); await pool.end();
  await fs.rm(tmp, { recursive: true, force: true });
});

test('admin: create a product, upload an opaque overlay (rejected) and a transparent one (accepted)', opts, async () => {
  const create = async (name) => (await j(await fetch(`${base}/api/admin/products`, authed('admin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, price: 999, status: 'active' }),
  })))).product;
  const p = await create(`AR Test Tee ${Date.now()}`);
  assert.ok(p?.id, 'product created');
  state.productIds = [p.id]; state.pid = p.id; state.slug = p.slug;

  const put = (buf, type, name) => fetch(`${base}/api/admin/ar/products/${p.id}/overlay`, authed('admin', { method: 'PUT', body: form({}, { overlay: [buf, type, name] }) }));
  assert.equal((await put(makePng(600, 700, { alpha: false }), 'image/png', 'opaque.png')).status, 400, 'opaque PNG refused');
  assert.equal((await put(fakeJpeg(600, 700), 'image/jpeg', 'x.jpg')).status, 400, 'JPEG refused');
  assert.equal((await put(makePng(100, 100, { alpha: true }), 'image/png', 'small.png')).status, 400, 'too small refused');
  const ok = await put(makePng(600, 700, { alpha: true }), 'image/png', 'tee overlay!.png');
  assert.equal(ok.status, 200);
  const body = await j(ok);
  assert.equal(body.overlay.width, 600);
  assert.equal(body.overlay.name, 'tee overlay_.png', 'client file name sanitised');
  assert.equal(body.eligible, false, 'uploaded but not enabled yet');
  const files = await fs.readdir(path.join(tmp, 'private', 'ar', 'overlays'));
  assert.equal(files.length, 1);
  assert.match(files[0], /^[0-9a-f-]{36}\.png$/);
});

test('admin: cannot enable 3D mode without a model; can enable overlay mode; draft products are never public', opts, async () => {
  const patch = (body) => fetch(`${base}/api/admin/ar/products/${state.pid}`, authed('admin', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  const cfg = { enabled: true, garmentType: 'top', assetMode: 'model3d', scaleAdjust: 1, offsetYAdjust: 0 };
  assert.equal((await patch(cfg)).status, 400, 'no 3D model yet');
  assert.equal((await patch({ ...cfg, scaleAdjust: 5 })).status, 400, 'out of range');
  const ok = await patch({ ...cfg, assetMode: 'overlay2d', scaleAdjust: 1.1, offsetYAdjust: -0.05 });
  assert.equal(ok.status, 200);
  const body = await j(ok);
  assert.equal(body.eligible, true);
  assert.equal(body.config.scaleAdjust, 1.1);

  const pub = await fetch(`${base}/api/ar/products/${state.slug}`);
  assert.equal(pub.status, 200);
  const data = await j(pub);
  assert.equal(data.ar.assetMode, 'overlay2d');
  assert.equal(data.ar.overlay.width, 600);
  assert.equal(data.capture.consentVersion, 'ar-v1');
  assert.equal(JSON.stringify(data).includes('storage'), false, 'no storage keys leak to customers');

  const prod = (await j(await fetch(`${base}/api/products/${state.slug}`))).product;
  assert.equal(prod.arEligible, true, 'product page flag');

  const file = await fetch(`${base}${data.ar.overlay.url}`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');

  // draft -> hidden from customers, still previewable by admin
  await pool.query("UPDATE products SET status = 'draft' WHERE id = ?", [state.pid]);
  assert.equal((await fetch(`${base}/api/ar/products/${state.slug}`)).status, 404);
  assert.equal((await fetch(`${base}${data.ar.overlay.url}`)).status, 404);
  assert.equal((await fetch(`${base}/api/admin/ar/products/${state.pid}/overlay/file`, authed('admin'))).status, 200);
  assert.equal((await fetch(`${base}/api/admin/ar/products/${state.pid}/overlay/file`, authed('cust'))).status, 403);
  await pool.query("UPDATE products SET status = 'active' WHERE id = ?", [state.pid]);
});

test('3D mode: eligibility follows the Phase 2 model (upload -> eligible, remove -> hidden)', opts, async () => {
  const glb = await fs.readFile(path.resolve(import.meta.dirname, '../../../docs/sample-assets/sample-tee-blocky.glb'));
  const created = (await j(await fetch(`${base}/api/admin/products`, authed('admin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `AR 3D Tee ${Date.now()}`, price: 1200, status: 'active' }),
  })))).product;
  state.productIds.push(created.id); state.pid3d = created.id; state.slug3d = created.slug;
  const up = await fetch(`${base}/api/admin/garments/product/${created.id}/model`, authed('admin', { method: 'PUT', body: form({}, { model: [glb, 'model/gltf-binary', 'tee.glb'] }) }));
  assert.equal(up.status, 200);
  const patch = await fetch(`${base}/api/admin/ar/products/${created.id}`, authed('admin', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, garmentType: 'outerwear', assetMode: 'model3d', scaleAdjust: 1, offsetYAdjust: 0 }),
  }));
  assert.equal(patch.status, 200);
  const data = await j(await fetch(`${base}/api/ar/products/${state.slug3d}`));
  assert.equal(data.ar.assetMode, 'model3d');
  assert.equal(data.ar.garmentType, 'outerwear');
  assert.equal(data.ar.overlay, null);
  assert.equal((await fetch(`${base}/api/garments/studio/${state.slug3d}`)).status, 200, 'Phase 2 studio still works for the same product');

  assert.equal((await fetch(`${base}/api/admin/garments/product/${created.id}/model`, authed('admin', { method: 'DELETE' }))).status, 204);
  assert.equal((await fetch(`${base}/api/ar/products/${state.slug3d}`)).status, 404, 'no model -> no longer eligible');
  const list = (await j(await fetch(`${base}/api/admin/ar/products`, authed('admin')))).items.find((i) => i.productId === created.id);
  assert.equal(list.enabled, true);
  assert.equal(list.eligible, false);
});

test('customer: saving a screenshot needs login, a customer role, consent, a valid image and an eligible product', opts, async () => {
  const png = makePng(360, 640);
  const post = (who, fields, files, extra) => fetch(`${base}/api/ar/captures`, { method: 'POST', body: form(fields, files), headers: who ? { Authorization: `Bearer ${tokens[who]}` } : {}, ...extra });
  const good = { productId: String(state.pid), consent: 'true', consentVersion: 'ar-v1' };
  const img = { image: [png, 'image/png', 'shot.png'] };

  assert.equal((await post(null, good, img)).status, 401);
  assert.equal((await post('admin', good, img)).status, 403, 'store owner cannot save customer screenshots');
  assert.equal((await post('cust', { ...good, consent: 'false' }, img)).status, 400, 'no consent');
  const noConsent = { productId: good.productId, consentVersion: 'ar-v1' };
  assert.equal((await post('cust', noConsent, img)).status, 400, 'consent missing');
  assert.equal((await post('cust', good, {})).status, 400, 'no image');
  assert.equal((await post('cust', good, { image: [Buffer.from('not an image at all'), 'image/png', 'x.png'] })).status, 400, 'bad bytes');
  assert.equal((await post('cust', good, { image: [Buffer.from('<svg/>'), 'image/svg+xml', 'x.svg'] })).status, 400, 'svg refused');
  assert.equal((await post('cust', { ...good, productId: '99999999' }, img)).status, 404, 'unknown product');
  assert.equal((await post('cust', { ...good, productId: String(state.pid3d) }, img)).status, 404, 'ineligible product');
  const files = await fs.readdir(path.join(tmp, 'private', 'ar', 'captures')).catch(() => []);
  assert.equal(files.length, 0, 'nothing is written to disk for rejected uploads');
});

test('customer: save, list, signed download, ownership isolation, delete', opts, async () => {
  const fields = { productId: String(state.pid), consent: 'true', consentVersion: 'ar-v1', config: JSON.stringify({ colorKey: 'navy', options: {} }) };
  const res = await fetch(`${base}/api/ar/captures`, authed('cust', { method: 'POST', body: form(fields, { image: [fakeJpeg(720, 1280), 'image/jpeg', 'ar.jpg'] }) }));
  assert.equal(res.status, 201);
  const { capture } = await j(res);
  assert.equal(capture.renderMode, 'overlay2d');
  assert.equal(capture.config, null, 'customization is only stored for 3D models');
  assert.equal(capture.product.slug, state.slug);
  assert.match(capture.imageUrl, /^\/api\/ar\/assets\/capture\/[0-9a-f-]{36}\?exp=\d+&u=\d+&sig=[0-9a-f]{64}$/);
  assert.ok(new Date(capture.expiresAt) > new Date(Date.now() + 80 * 86400000), 'default retention ~90 days');
  const [[row]] = await pool.query('SELECT * FROM ar_captures WHERE public_id = ?', [capture.id]);
  assert.equal(row.consent_version, 'ar-v1');
  assert.ok(row.consented_at);
  const stored = await fs.readdir(path.join(tmp, 'private', 'ar', 'captures'));
  assert.equal(stored.length, 1);
  assert.equal(JSON.stringify(capture).includes(row.capture_key), false, 'storage key is not exposed');

  // list: only my own
  const mine = await j(await fetch(`${base}/api/ar/captures`, authed('cust')));
  assert.equal(mine.items.length, 1);
  assert.equal((await j(await fetch(`${base}/api/ar/captures`, authed('other')))).items.length, 0);

  // signed file
  const img = await fetch(`${base}${capture.imageUrl}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal(img.headers.get('content-disposition'), 'inline');
  const dl = await fetch(`${base}${capture.imageUrl}&dl=1`); // dl only changes Content-Disposition; it is not a privilege
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /^attachment; filename="ai-fashion-studio-ar\.jpg"$/);
  const forged = capture.imageUrl.replace(/u=\d+/, 'u=999999');
  assert.equal((await fetch(`${base}${forged}`)).status, 404, 'u tampering');
  const otherUser = (await j(await fetch(`${base}/api/auth/me`, authed('other')))).user.id;
  assert.equal((await fetch(`${base}${capture.imageUrl.replace(/u=\d+/, `u=${otherUser}`)}`)).status, 404, 'another customer cannot reuse the URL');

  // other customer cannot delete
  assert.equal((await fetch(`${base}/api/ar/captures/${capture.id}`, authed('other', { method: 'DELETE' }))).status, 404);
  assert.equal((await fetch(`${base}/api/ar/captures/${capture.id}`, authed('admin', { method: 'DELETE' }))).status, 403);
  assert.equal((await fetch(`${base}/api/ar/captures/${capture.id}`, authed('cust', { method: 'DELETE' }))).status, 204);
  assert.equal((await fs.readdir(path.join(tmp, 'private', 'ar', 'captures'))).length, 0, 'file removed from disk');
  assert.equal((await fetch(`${base}${capture.imageUrl}`)).status, 404);
  assert.equal((await fetch(`${base}/api/ar/captures/${capture.id}`, authed('cust', { method: 'DELETE' }))).status, 404);
});

test('customer: per-customer limit, delete-all, retention purge', opts, async () => {
  const { arService } = await import('../src/modules/ar/ar.index.js');
  const save = () => fetch(`${base}/api/ar/captures`, authed('other', { method: 'POST', body: form({ productId: String(state.pid), consent: 'true', consentVersion: 'ar-v1' }, { image: [fakeJpeg(480, 640), 'image/jpeg', 'a.jpg'] }) }));
  const max = env.ar.maxCapturesPerUser;
  for (let i = 0; i < max; i += 1) assert.equal((await save()).status, 201, `save ${i + 1}`);
  const over = await save();
  assert.equal(over.status, 400);
  assert.match((await j(over)).error.message, /up to \d+ saved AR screenshots/);
  assert.equal((await fs.readdir(path.join(tmp, 'private', 'ar', 'captures'))).length, max, 'rejected save leaves no orphan file');

  // expire a few and purge
  await pool.query("UPDATE ar_captures SET expires_at = '2000-01-01 00:00:00' WHERE user_id = (SELECT id FROM users WHERE email = ?) LIMIT 3", [state.otherEmail]);
  assert.equal((await arService.purgeExpired()).deleted, 3);
  assert.equal((await fs.readdir(path.join(tmp, 'private', 'ar', 'captures'))).length, max - 3);

  const all = await j(await fetch(`${base}/api/ar/captures`, authed('other', { method: 'DELETE' })));
  assert.equal(all.deleted, max - 3);
  assert.equal((await fs.readdir(path.join(tmp, 'private', 'ar', 'captures'))).length, 0);
});

test('product deletion removes the overlay file and keeps the customer capture (product becomes NULL)', opts, async () => {
  const fields = { productId: String(state.pid), consent: 'true', consentVersion: 'ar-v1' };
  const res = await fetch(`${base}/api/ar/captures`, authed('cust', { method: 'POST', body: form(fields, { image: [fakeJpeg(480, 640), 'image/jpeg', 'a.jpg'] }) }));
  assert.equal(res.status, 201);
  const { capture } = await j(res);
  assert.equal((await fs.readdir(path.join(tmp, 'private', 'ar', 'overlays'))).length, 1);
  assert.equal((await fetch(`${base}/api/admin/products/${state.pid}`, authed('admin', { method: 'DELETE' }))).status, 204);
  assert.equal((await fs.readdir(path.join(tmp, 'private', 'ar', 'overlays'))).length, 0, 'overlay file removed with the product');
  const [[row]] = await pool.query('SELECT product_id, product_name FROM ar_captures WHERE public_id = ?', [capture.id]);
  assert.equal(row.product_id, null);
  assert.ok(row.product_name, 'name snapshot kept');
  await fetch(`${base}/api/ar/captures/${capture.id}`, authed('cust', { method: 'DELETE' }));
});

test('removing the overlay of an overlay-mode product disables AR for it', opts, async () => {
  const create = await j(await fetch(`${base}/api/admin/products`, authed('admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `AR Ov ${Date.now()}`, price: 10, status: 'active' }) })));
  const id = create.product.id; state.productIds.push(id);
  await fetch(`${base}/api/admin/ar/products/${id}/overlay`, authed('admin', { method: 'PUT', body: form({}, { overlay: [makePng(500, 500, { alpha: true }), 'image/png', 'o.png'] }) }));
  await fetch(`${base}/api/admin/ar/products/${id}`, authed('admin', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, garmentType: 'top', assetMode: 'overlay2d', scaleAdjust: 1, offsetYAdjust: 0 }) }));
  const del = await j(await fetch(`${base}/api/admin/ar/products/${id}/overlay`, authed('admin', { method: 'DELETE' })));
  assert.equal(del.autoDisabled, true);
  assert.equal(del.config.enabled, false);
  assert.equal((await fetch(`${base}/api/admin/ar/products/${id}/overlay`, authed('admin', { method: 'DELETE' }))).status, 404);
});
