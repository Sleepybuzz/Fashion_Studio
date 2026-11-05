import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { badRequest } from '../../utils/AppError.js';
import { passwordRule } from '../auth/auth.schemas.js';
import { hashPassword, toPublicUser } from '../auth/auth.service.js';

const router = Router();
router.use(requireAuth);

const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+()\-\s]*$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(72),
  newPassword: passwordRule,
});

router.get('/me', (req, res) => res.json({ user: toPublicUser(req.user) }));

router.patch('/me', validate(profileSchema), asyncHandler(async (req, res) => {
  const { fullName, phone } = req.body;
  await pool.query('UPDATE users SET full_name = ?, phone = ? WHERE id = ?', [
    fullName,
    phone || null,
    req.user.id,
  ]);
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ user: toPublicUser(rows[0]) });
}));

router.put('/me/password', validate(passwordSchema), asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  const ok = await bcrypt.compare(req.body.currentPassword, rows[0].password_hash);
  if (!ok) throw badRequest('Current password is incorrect', { currentPassword: 'Incorrect password' });
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [
    await hashPassword(req.body.newPassword),
    req.user.id,
  ]);
  res.json({ message: 'Password updated' });
}));

export default router;
