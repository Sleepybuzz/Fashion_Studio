import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { loginSchema, registerSchema } from './auth.schemas.js';
import { login, registerCustomer, toPublicUser } from './auth.service.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts. Please try again later.' } },
});

router.post('/register', authLimiter, validate(registerSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await registerCustomer(req.body));
}));

router.post('/login', authLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  res.json(await login(req.body));
}));

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

export default router;
