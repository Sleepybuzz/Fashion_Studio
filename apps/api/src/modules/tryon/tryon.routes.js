import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { requireAdmin, requireAuth, requireRole } from '../../middleware/auth.js';
import { tryOnGarmentUpload, tryOnPhotoUpload } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { notFound } from '../../utils/AppError.js';
import { verifyAsset } from './signing.js';
import { EXT_FOR_MIME } from './tryon.constants.js';
import { catalog, signingKey, storage, tryOnService as svc } from './tryon.index.js';
import {
  assetParamsSchema, assetQuerySchema, customVersionParamSchema, configBodySchema, createSessionSchema, imageParamsSchema,
  listQuerySchema, productIdParamSchema, savedBodySchema, uuidParamSchema,
} from './tryon.schemas.js';

const perUser = (req) => `u${req.user.id}`;
const limiter = (windowMs, limit, message) => rateLimit({
  windowMs, limit, keyGenerator: perUser, standardHeaders: true, legacyHeaders: false, message: { error: { message } },
});
// Paid operations: tight. Polling: generous (the web app polls about every 2 seconds while a try-on runs).
const createLimiter = limiter(60 * 60 * 1000, env.tryon.userHourlyLimit, 'Too many try-on requests. Please try again later.');
const pollLimiter = limiter(60 * 1000, 90, 'Too many requests. Please slow down.');

/** Mounted at /api/tryon */
export const customerRouter = Router();

// ---- Private images, authorised by a short-lived HMAC signature instead of a Bearer token (see signing.js).
customerRouter.get('/assets/:kind/:id', validate(assetParamsSchema, 'params'), validate(assetQuerySchema, 'query'), asyncHandler(async (req, res, next) => {
  const { kind, id } = req.validated.params;
  const { exp, u, sig, dl } = req.validated.query;
  if (!verifyAsset(signingKey, { kind, id, exp, u, sig })) throw notFound('Image not found');

  let file;
  if (kind === 'garment') {
    const img = await catalog.getImageFile(Number(id));
    if (!img) throw notFound('Image not found');
    file = { kind: 'garments', key: img.key, mime: img.mime };
  } else {
    file = await svc.resolveSessionFile(kind, id, u);
  }
  res.setHeader('Content-Type', file.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Disposition', dl ? `attachment; filename="ai-fashion-studio-${kind}.${EXT_FOR_MIME[file.mime] || 'jpg'}"` : 'inline');
  res.sendFile(file.key, { root: storage.dirFor(file.kind), dotfiles: 'deny' }, (err) => {
    if (err && !res.headersSent) next(err.code === 'ENOENT' ? notFound('Image not found') : err);
  });
}));

// ---- Everything below needs a signed-in customer.
customerRouter.use(requireAuth, requireRole('customer'));

customerRouter.get('/config', asyncHandler(async (req, res) => {
  res.json(await svc.getPublicConfig(req.user));
}));

customerRouter.get('/eligibility/custom/:versionId', validate(customVersionParamSchema, 'params'), asyncHandler(async (req, res) => {
  res.json(await svc.getCustomEligibility(req.user, req.validated.params.versionId));
}));

customerRouter.get('/eligibility/:slug', asyncHandler(async (req, res) => {
  res.json(await svc.getEligibility(String(req.params.slug).slice(0, 220)));
}));

customerRouter.get('/sessions', validate(listQuerySchema, 'query'), asyncHandler(async (req, res) => {
  const { page, limit } = req.validated.query;
  const out = await svc.listSessions(req.user, { limit, offset: (page - 1) * limit });
  res.json({ ...out, page, limit });
}));

// Auth and the rate limit run BEFORE multer, so unauthenticated or abusive callers never get their upload buffered.
customerRouter.post('/sessions', createLimiter, tryOnPhotoUpload, validate(createSessionSchema), asyncHandler(async (req, res) => {
  const session = await svc.createSession({
    user: req.user, // identity comes from the JWT only; a client-supplied user id is never read
    productId: req.body.productId,
    customizationVersionId: req.body.customizationVersionId,
    consent: req.body.consent,
    consentVersion: req.body.consentVersion,
    photo: req.file,
  });
  res.status(202).json({ session });
}));

customerRouter.delete('/sessions', asyncHandler(async (req, res) => {
  res.json(await svc.deleteAll(req.user));
}));

customerRouter.get('/sessions/:id', pollLimiter, validate(uuidParamSchema, 'params'), asyncHandler(async (req, res) => {
  res.json({ session: await svc.getSession(req.user, req.validated.params.id) });
}));

customerRouter.post('/sessions/:id/retry', createLimiter, validate(uuidParamSchema, 'params'), asyncHandler(async (req, res) => {
  res.status(202).json({ session: await svc.retrySession(req.user, req.validated.params.id) });
}));

customerRouter.patch('/sessions/:id/saved', validate(uuidParamSchema, 'params'), validate(savedBodySchema), asyncHandler(async (req, res) => {
  res.json({ session: await svc.setSaved(req.user, req.validated.params.id, req.body.saved) });
}));

customerRouter.delete('/sessions/:id', validate(uuidParamSchema, 'params'), asyncHandler(async (req, res) => {
  await svc.deleteSession(req.user, req.validated.params.id);
  res.status(204).end();
}));

/**
 * Mounted at /api/admin/tryon. The store owner manages product eligibility, garment photos and sees aggregate
 * usage. There is intentionally NO admin route that returns a customer's photo or result.
 */
export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get('/overview', asyncHandler(async (_req, res) => res.json(await svc.adminOverview())));
adminRouter.get('/provider/credits', asyncHandler(async (_req, res) => res.json(await svc.adminCredits())));

adminRouter.get('/products', asyncHandler(async (_req, res) => res.json({ items: await catalog.adminList() })));

adminRouter.get('/products/:productId', validate(productIdParamSchema, 'params'), asyncHandler(async (req, res) => {
  res.json(await catalog.adminGet(req.validated.params.productId, req.user.id));
}));

adminRouter.patch('/products/:productId', validate(productIdParamSchema, 'params'), validate(configBodySchema), asyncHandler(async (req, res) => {
  const { productId } = req.validated.params;
  await catalog.saveConfig(productId, req.body);
  res.json(await catalog.adminGet(productId, req.user.id));
}));

adminRouter.post('/products/:productId/images', validate(productIdParamSchema, 'params'), tryOnGarmentUpload, asyncHandler(async (req, res) => {
  const { productId } = req.validated.params;
  await catalog.addImage(productId, req.file);
  res.status(201).json(await catalog.adminGet(productId, req.user.id));
}));

adminRouter.put('/products/:productId/images/:imageId', validate(imageParamsSchema, 'params'), tryOnGarmentUpload, asyncHandler(async (req, res) => {
  const { productId, imageId } = req.validated.params;
  await catalog.replaceImage(productId, imageId, req.file);
  res.json(await catalog.adminGet(productId, req.user.id));
}));

adminRouter.delete('/products/:productId/images/:imageId', validate(imageParamsSchema, 'params'), asyncHandler(async (req, res) => {
  const { productId, imageId } = req.validated.params;
  const { autoDisabled } = await catalog.removeImage(productId, imageId);
  res.json({ ...(await catalog.adminGet(productId, req.user.id)), autoDisabled });
}));
