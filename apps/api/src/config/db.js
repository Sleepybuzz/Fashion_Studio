import mysql from 'mysql2/promise';
import { env } from './env.js';

/** Shared MySQL connection pool (parameterized queries only). */
export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: env.dbPoolSize,
  connectTimeout: 10000,
  enableKeepAlive: true,
  idleTimeout: 60000,
  decimalNumbers: true,
  charset: 'utf8mb4',
  ...(env.db.ssl ? { ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } } : {}),
});

/** Run a function inside a transaction. */
export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
