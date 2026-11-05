import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';
import { env } from '../../config/env.js';
import { conflict, unauthorized } from '../../utils/AppError.js';

const BCRYPT_ROUNDS = 12;
// Pre-computed hash used to keep login timing similar when the email is unknown.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

export const toPublicUser = (u) => ({
  id: u.id,
  email: u.email,
  fullName: u.full_name,
  phone: u.phone ?? null,
  role: u.role,
});

export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);

export function signToken(user) {
  return jwt.sign({ role: user.role }, env.jwtSecret, {
    subject: String(user.id),
    expiresIn: env.jwtExpiresIn,
    algorithm: 'HS256',
  });
}

export async function registerCustomer({ fullName, email, password }) {
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing.length) throw conflict('An account with this email already exists');

  const passwordHash = await hashPassword(password);
  const [result] = await pool.query(
    "INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, 'customer')",
    [email, passwordHash, fullName],
  );
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
  return { user: toPublicUser(rows[0]), token: signToken(rows[0]) };
}

export async function login({ email, password }) {
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || !user.is_active) throw unauthorized('Invalid email or password');
  return { user: toPublicUser(user), token: signToken(user) };
}
