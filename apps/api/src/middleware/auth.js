import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { unauthorized, forbidden } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** Require a valid Bearer JWT; loads the active user into req.user. */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw unauthorized('Invalid or expired session');
  }

  const [rows] = await pool.query(
    'SELECT id, email, full_name, phone, role, is_active FROM users WHERE id = ? LIMIT 1',
    [payload.sub],
  );
  const user = rows[0];
  if (!user || !user.is_active) throw unauthorized('Account not available');
  req.user = user;
  next();
});

/** Require one of the given roles. Use after requireAuth. */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  return next();
};

export const requireAdmin = [requireAuth, requireRole('admin')];
