import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { env, REPO_ROOT } from '../src/config/env.js';

const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'migrations');

if (!env.db.user) {
  console.error('[migrate] DB_USER is not set in apps/api/.env');
  process.exit(1);
}

const base = { host: env.db.host, port: env.db.port, user: env.db.user, password: env.db.password, multipleStatements: true };
const dbName = env.db.database;
if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  console.error('[migrate] DB_NAME may only contain letters, numbers and underscores');
  process.exit(1);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function main() {
  const admin = await mysql.createConnection(base);
  // Creating the database is non-destructive (IF NOT EXISTS). No tables are ever dropped.
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();

  const conn = await mysql.createConnection({ ...base, database: dbName });
  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(255) NOT NULL PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);

  const [applied] = await conn.query('SELECT name, checksum FROM schema_migrations');
  const done = new Map(applied.map((r) => [r.name, r.checksum]));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  let ran = 0;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    if (done.has(file)) {
      if (done.get(file) !== sha(sql)) console.warn(`[migrate] WARNING: ${file} changed after being applied. Add a new migration instead.`);
      continue;
    }
    console.log(`[migrate] applying ${file}`);
    await conn.query(sql);
    await conn.query('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [file, sha(sql)]);
    ran += 1;
  }
  await conn.end();
  console.log(ran ? `[migrate] done, ${ran} migration(s) applied.` : '[migrate] database is up to date.');
}

main().catch((err) => {
  console.error('[migrate] failed:', err.message);
  process.exit(1);
});
