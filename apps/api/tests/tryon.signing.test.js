import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSigningKey, signAsset, verifyAsset, signedPath } from '../src/modules/tryon/signing.js';
import { isSafeRemoteUrl } from '../src/modules/tryon/download.js';
import { createTryOnStorage, isValidStorageKey } from '../src/modules/tryon/tryon.storage.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const key = deriveSigningKey('a-test-secret-that-is-long-enough-123456');
const base = { kind: 'result', id: 'abc', userId: 7, ttlSeconds: 60, nowMs: 1_000_000 };

test('a signature verifies only for the same kind, id, user and before expiry', () => {
  const { exp, u, sig } = signAsset(key, base);
  assert.ok(verifyAsset(key, { kind: 'result', id: 'abc', exp, u, sig, nowMs: 1_000_000 }));
  assert.ok(!verifyAsset(key, { kind: 'photo', id: 'abc', exp, u, sig, nowMs: 1_000_000 }));
  assert.ok(!verifyAsset(key, { kind: 'result', id: 'abd', exp, u, sig, nowMs: 1_000_000 }));
  assert.ok(!verifyAsset(key, { kind: 'result', id: 'abc', exp, u: 8, sig, nowMs: 1_000_000 }));
  assert.ok(!verifyAsset(key, { kind: 'result', id: 'abc', exp, u, sig, nowMs: 1_000_000 + 61_000 }));
  assert.ok(!verifyAsset(key, { kind: 'result', id: 'abc', exp, u, sig: 'zz', nowMs: 1_000_000 }));
  assert.ok(!verifyAsset(deriveSigningKey('another-secret-another-secret-12345678'), { kind: 'result', id: 'abc', exp, u, sig, nowMs: 1_000_000 }));
});

test('signedPath builds a relative API path', () => {
  const p = signedPath(key, '/api', base);
  assert.match(p, /^\/api\/tryon\/assets\/result\/abc\?exp=\d+&u=7&sig=[0-9a-f]{64}$/);
});

test('result URL safety check blocks non-https and private hosts', () => {
  assert.ok(isSafeRemoteUrl('https://storage.googleapis.com/x/y.png'));
  for (const bad of ['http://a.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.1/x',
    'https://169.254.169.254/latest', 'https://[::1]/x', 'https://user:pw@a.com/x', 'file:///etc/passwd', 'nonsense']) {
    assert.ok(!isSafeRemoteUrl(bad), bad);
  }
});

test('storage uses random server keys, rejects traversal, and removal is idempotent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tryon-'));
  const st = createTryOnStorage(dir);
  const k = await st.save('photos', Buffer.from('x'), 'jpg');
  assert.ok(isValidStorageKey(k));
  assert.equal((await st.read('photos', k)).toString(), 'x');
  assert.ok(!isValidStorageKey('../../etc/passwd'));
  await assert.rejects(() => st.read('photos', '../../etc/passwd'));
  await assert.rejects(() => st.save('nope', Buffer.from('x'), 'jpg'));
  assert.equal(await st.remove('photos', k), true);
  assert.equal(await st.remove('photos', k), false);
  assert.equal(await st.remove('photos', '../bad'), false);
  await fs.rm(dir, { recursive: true, force: true });
});
