import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { requireAdmin, requireAuth, requireRole } from '../../middleware/auth.js';
import { arCaptureUpload, arOverlayUpload } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { notFound } from '../../utils/AppError.js';
import { verifyAsset } from '../tryon/signing.js';
import { EXT_FOR_MIME } from '../tryon/tryon.constants.js';
import { SIGN_KIND, arService as svc, signingKey, storage } from './ar.index.js';
import {
  adminConfigSchema, assetParamsSchema, assetQuerySchema, createCaptureSchema, productIdParamSchema, slugParamSchema, uuidParamSchema,
} from './ar.schemas.js';

/** Stream a private file with safe headers. `file.key` was validated by the storage layer. */
function sendPrivate(res, next, { kind, key, mime, etag }, cache, extra = {}) {
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cache);
  if (etag) res.setHeader('ETag', `"${etag}"`);
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  storage.send(res, kind, key, (err) => {
    if (err && !res.headersSent) next(err.code === 'ENOENT' ? notFound('File not found') : err);
  });
}

const saveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: env.ar.hourlySaveLimit, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u${req.user.id}`, message: { error: { message: 'Too many screenshots saved. Please try again later.' } },
});

/** Mounted at /api/ar. Viewing AR needs no account (nothing leaves the device); saving a screenshot does. */
export const customerRouter = Router();

customerRouter.get('/products/:slug', validate(slugParamSchema, 'params'), asyncHandler(async (req, res) => {
  res.json(await svc.getPublicProduct(req.validated.params.slug));
}));

// Transparent garment overlay of an AR-enabled, active product (marketing asset, not customer data).
customerRouter.get('/overlays/:productId/file', validate(productIdParamSchema, 'params'), asyncHandler(async (req, res, next) => {
  const f = await svc.resolveOverlayFile(req.validated.params.productId);
  sendPrivate(res, next, { kind: 'overlays', key: f.key, mime: f.mime, etag: f.sha256 }, 'public, max-age=3600');
}));

// Saved screenshots: authorised by a short-lived HMAC signature (an <img> tag cannot send a Bearer token).
customerRouter.get('/assets/capture/:id', validate(assetParamsSchema, 'params'), validate(assetQuerySchema, 'query'), asyncHandler(async (req, res, next) => {
  const { id } = req.validated.params;
  const { exp, u, sig, dl } = req.validated.query;
  if (!verifyAsset(signingKey, { kind: SIGN_KIND, id, exp, u, sig })) throw notFound('Image not found');
  const f = await svc.resolveCaptureFile(id, u);
  sendPrivate(res, next, { kind: 'captures', key: f.key, mime: f.mime }, 'private, max-age=300',
    { 'Content-Disposition': dl ? `attachment; filename="ai-fashion-studio-ar.${EXT_FOR_MIME[f.mime] || 'jpg'}"` : 'inline' });
}));

// ---- Everything below needs a signed-in customer.
customerRouter.use(requireAuth, requireRole('customer'));

customerRouter.get('/captures', asyncHandler(async (req, res) => res.json(await svc.listCaptures(req.user.id))));

// Auth and the rate limit run BEFORE multer, so unauthenticated or abusive callers never get their upload buffered.
customerRouter.post('/captures', saveLimiter, arCaptureUpload, validate(createCaptureSchema), asyncHandler(async (req, res) => {
  const capture = await svc.createCapture({
    user: req.user, // identity comes from the JWT only; a client-supplied user id is never read
    productId: req.body.productId,
    file: req.file,
    consentVersion: req.body.consentVersion,
    config: req.body.config,
  });
  res.status(201).json({ capture });
}));

customerRouter.delete('/captures', asyncHandler(async (req, res) => res.json(await svc.deleteAll(req.user.id))));

customerRouter.delete('/captures/:id', validate(uuidParamSchema, 'params'), asyncHandler(async (req, res) => {
  await svc.deleteCapture(req.user.id, req.validated.params.id);
  res.status(204).end();
}));

/** Mounted at /api/admin/ar. Store owner only. There is no admin route that returns a customer's screenshot. */
export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get('/products', asyncHandler(async (_req, res) => res.json({ items: await svc.adminList() })));

adminRouter.get('/products/:productId', validate(productIdParamSchema, 'params'), asyncHandler(async (req, res) => {
  res.json(await svc.adminGet(req.validated.params.productId));
}));

adminRouter.patch('/products/:productId', validate(productIdParamSchema, 'params'), validate(adminConfigSchema), asyncHandler(async (req, res) => {
  const { productId } = req.validated.params;
  await svc.saveConfig(productId, req.body);
  res.json(await svc.adminGet(productId));
}));

adminRouter.put('/products/:productId/overlay', validate(productIdParamSchema, 'params'), arOverlayUpload, asyncHandler(async (req, res) => {
  const { productId } = req.validated.params;
  await svc.saveOverlay(productId, req.file);
  res.json(await svc.adminGet(productId));
}));

adminRouter.delete('/products/:productId/overlay', validate(productIdParamSchema, 'params'), asyncHandler(async (req, res) => {
  const { productId } = req.validated.params;
  const { autoDisabled } = await svc.removeOverlay(productId);
  res.json({ ...(await svc.adminGet(productId)), autoDisabled });
}));

// Admin preview of the overlay, including draft products (authenticated download, never cached).
adminRouter.get('/products/:productId/overlay/file', validate(productIdParamSchema, 'params'), asyncHandler(async (req, res, next) => {
  const f = await svc.resolveOverlayFile(req.validated.params.productId, { admin: true });
  sendPrivate(res, next, { kind: 'overlays', key: f.key, mime: f.mime }, 'private, no-store');
}));