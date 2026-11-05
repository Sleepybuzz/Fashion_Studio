import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.DB_USER = 'nobody';

const { createApp } = await import('../src/app.js');
const { registerSchema } = await import('../src/modules/auth/auth.schemas.js');
const { productBodySchema } = await import('../src/modules/products/products.schemas.js');
const { slugify } = await import('../src/utils/slug.js');
const { pool } = await import('../src/config/db.js');

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.end().catch(() => {});
});

test('slugify produces url-safe slugs', () => {
  assert.equal(slugify('  Wool Blend Overcoat! '), 'wool-blend-overcoat');
});

test('register schema rejects weak passwords and normalises email', () => {
  assert.equal(registerSchema.safeParse({ fullName: 'Ann', email: 'a@b.co', password: 'short1' }).success, false);
  const ok = registerSchema.safeParse({ fullName: 'Ann Lee', email: ' A@B.CO ', password: 'longenough1' });
  assert.equal(ok.success, true);
  assert.equal(ok.data.email, 'a@b.co');
});

test('product schema validates and applies defaults', () => {
  assert.equal(productBodySchema.safeParse({ name: 'x', price: 10 }).success, false);
  const r = productBodySchema.safeParse({ name: 'Shirt', price: '19.5', variants: [{ sku: 'S1', stockQuantity: 3 }] });
  assert.equal(r.success, true);
  assert.equal(r.data.status, 'active');
  assert.equal(r.data.price, 19.5);
});

test('product schema rejects javascript: image URLs', () => {
  const r = productBodySchema.safeParse({ name: 'Shirt', price: 5, images: [{ url: 'javascript:alert(1)' }] });
  assert.equal(r.success, false);
});

test('protected routes return 401 without a token', async () => {
  for (const p of ['/api/auth/me', '/api/users/me', '/api/wishlist', '/api/admin/stats', '/api/admin/products']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 401, p);
  }
});

test('admin upload endpoint refuses unauthenticated requests', async () => {
  const res = await fetch(`${base}/api/admin/uploads/product-image`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('invalid login payload returns 400 with field errors', async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nope' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.details.email);
});

test('unknown routes return 404 JSON', async () => {
  const res = await fetch(`${base}/api/nothing`);
  assert.equal(res.status, 404);
});
