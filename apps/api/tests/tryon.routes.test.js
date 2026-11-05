import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.DB_USER = 'nobody';

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/config/db.js');

let server;
let base;
before(() => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); await pool.end().catch(() => {}); });

test('customer try-on endpoints require authentication (including the upload)', async () => {
  for (const [method, p] of [['GET', '/api/tryon/config'], ['GET', '/api/tryon/eligibility/x'], ['GET', '/api/tryon/sessions'],
    ['POST', '/api/tryon/sessions'], ['DELETE', '/api/tryon/sessions'], ['GET', '/api/tryon/sessions/3f2b8a3e-0000-4000-8000-000000000000'],
    ['POST', '/api/tryon/sessions/3f2b8a3e-0000-4000-8000-000000000000/retry'], ['PATCH', '/api/tryon/sessions/3f2b8a3e-0000-4000-8000-000000000000/saved'],
    ['DELETE', '/api/tryon/sessions/3f2b8a3e-0000-4000-8000-000000000000']]) {
    assert.equal((await fetch(base + p, { method })).status, 401, `${method} ${p}`);
  }
});

test('admin try-on endpoints refuse unauthenticated requests', async () => {
  for (const [method, p] of [['GET', '/api/admin/tryon/overview'], ['GET', '/api/admin/tryon/provider/credits'], ['GET', '/api/admin/tryon/products'],
    ['GET', '/api/admin/tryon/products/1'], ['PATCH', '/api/admin/tryon/products/1'], ['POST', '/api/admin/tryon/products/1/images'],
    ['PUT', '/api/admin/tryon/products/1/images/1'], ['DELETE', '/api/admin/tryon/products/1/images/1']]) {
    assert.equal((await fetch(base + p, { method })).status, 401, `${method} ${p}`);
  }
});

test('signed image URLs reject missing or forged signatures without touching the database', async () => {
  assert.equal((await fetch(`${base}/api/tryon/assets/photo/abc`)).status, 400);
  const forged = `${base}/api/tryon/assets/photo/3f2b8a3e-0000-4000-8000-000000000000?exp=9999999999&u=1&sig=${'0'.repeat(64)}`;
  assert.equal((await fetch(forged)).status, 404);
  const expired = `${base}/api/tryon/assets/result/abc?exp=1&u=1&sig=${'a'.repeat(64)}`;
  assert.equal((await fetch(expired)).status, 404);
});
