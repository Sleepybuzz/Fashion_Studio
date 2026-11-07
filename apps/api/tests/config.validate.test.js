import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config/validate.js';

const good = { isProd: true, jwtSecret: 'f3a9c1d27b8e4a60915d2c7e8b4f1a36d9e0c5b7a2f8143e', frontendOrigins: ['https://demo.example.com'], seed: { adminPassword: '' } };

test('a strong secret and https origin pass in production', () => {
  assert.deepEqual(validateConfig(good), []);
});
test('placeholder JWT secrets are rejected', () => {
  assert.equal(validateConfig({ ...good, jwtSecret: 'changeme'.padEnd(40, 'x') }).length, 1);
  assert.equal(validateConfig({ ...good, jwtSecret: 'a'.repeat(40) }).length, 1);
});
test('production rejects http and localhost origins; development allows them', () => {
  assert.ok(validateConfig({ ...good, frontendOrigins: ['http://demo.example.com'] }).length >= 1);
  assert.ok(validateConfig({ ...good, frontendOrigins: ['https://localhost'] }).length >= 1);
  assert.deepEqual(validateConfig({ ...good, isProd: false, frontendOrigins: ['http://localhost:5173'] }), []);
});
test('invalid and empty origins are reported', () => {
  assert.ok(validateConfig({ ...good, frontendOrigins: ['not a url'] }).length >= 1);
  assert.ok(validateConfig({ ...good, frontendOrigins: [] }).length >= 1);
});
