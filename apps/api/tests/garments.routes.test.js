import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.DB_USER = 'nobody';

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/config/db.js');

let server;
let base;
before(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.end().catch(() => {});
});

test('saved-design endpoints require authentication', async () => {
  for (const [method, p] of [['GET', '/api/customizations'], ['POST', '/api/customizations'], ['GET', '/api/customizations/1'], ['PUT', '/api/customizations/1'], ['DELETE', '/api/customizations/1']]) {
    const res = await fetch(base + p, { method });
    assert.equal(res.status, 401, `${method} ${p}`);
  }
});

test('garment admin endpoints (including upload) refuse unauthenticated requests', async () => {
  for (const [method, p] of [
    ['GET', '/api/admin/garments'], ['GET', '/api/admin/garments/product/1'], ['PUT', '/api/admin/garments/product/1/model'],
    ['PATCH', '/api/admin/garments/product/1/model'], ['DELETE', '/api/admin/garments/product/1/model'],
    ['GET', '/api/admin/garments/product/1/model/file'], ['PUT', '/api/admin/garments/product/1/options'],
  ]) {
    const res = await fetch(base + p, { method });
    assert.equal(res.status, 401, `${method} ${p}`);
  }
});

test('public garment routes validate their parameters before touching the database', async () => {
  const res = await fetch(`${base}/api/garments/assets/not-a-number/file`);
  assert.equal(res.status, 400);
});
