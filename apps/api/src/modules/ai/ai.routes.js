import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { requireAdmin, requireAuth, requireRole } from '../../middleware/auth.js';
import { aiImageUpload } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { notFound } from '../../utils/AppError.js';
import { verifyAsset } from '../tryon/signing.js';
import { EXT_FOR_MIME } from '../tryon/tryon.constants.js';
import { aiService as svc, aiStorage as storage } from './ai.index.js';
import { SIGN_KINDS, aiSigningKey } from './ai.shared.js';
import {
  assetParamsSchema, assetQuerySchema, createSessionSchema, listSessionsQuerySchema, messageBodySchema, methodsQuerySchema,
  saveBodySchema, uuidParamSchema, versionParamsSchema,
} from './validators/ai.schemas.js';

const perUser = (req) => `u${req.user.id}`;
const limiter = (windowMs, limit, message) => rateLimit({
  windowMs, limit, keyGenerator: perUser, standardHeaders: true, legacyHeaders: false, message: { error: { message } },
});
// Messages (each may start a paid image edit): an hourly ceiling plus a short burst limit against accidental floods.
const messageHourly = limiter(60 * 60 * 1000, env.ai.chatUserHourlyLimit, 'You are sending messages too quickly. Please try again later.');
const messageBurst = limiter(60 * 1000, 8, 'Please slow down a little.');
const createLimiter = limiter(60 * 60 * 1000, 30, 'Too many new sessions. Please try again later.');
const pollLimiter = limiter(60 * 1000, 120, 'Too many requests. Please slow down.');

/** Mounted at /api/ai */
export const customerRouter = Router();

// ---- Public: which capabilities are available. Booleans and display labels only (no keys, no models, no config details).
customerRouter.get('/status', asyncHandler(async (_req, res) => { res.json(svc.providerStatus()); }));

// ---- Private images, authorised by a short-lived HMAC signature instead of a Bearer token (see ai.shared.js).
customerRouter.get('/assets/:which/:id', validate(assetParamsSchema, 'params'), validate(assetQuerySchema, 'query'), asyncHandler(async (req, res, next) => {
  const { which, id } = req.validated.params;
  const { exp, u, sig, dl } = req.validated.query;
  if (!verifyAsset(aiSigningKey, { kind: SIGN_KINDS[which], id, exp, u, sig })) throw notFound('Image not found');
  const file = await svc.resolveFile(which, id, u);
  res.setHeader('Content-Type', file.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Disposition', dl ? `attachment; filename="ai-fashion-studio-${which}.${EXT_FOR_MIME[file.mime] || 'jpg'}"` : 'inline');
  res.sendFile(file.key, { root: storage.dirFor(file.kind), dotfiles: 'deny' }, (err) => {
    if (err && !res.headersSent) next(err.code === 'ENOENT' ? notFound('Image not found') : err);
  });
}));

// ---- Everything below needs a signed-in customer.
customerRouter.use(requireAuth, requireRole('customer'));

customerRouter.get('/config', asyncHandler(async (_req, res) => { res.json(await svc.getConfig()); }));

customerRouter.get('/sessions', validate(listSessionsQuerySchema, 'query'), asyncHandler(async (req, res) => {
  res.json({ items: await svc.listSessions(req.user, { productId: req.validated.query.productId }) });
}));

// Auth and the rate limit run BEFORE multer, so unauthenticated or abusive callers never get their upload buffered.
customerRouter.post('/sessions', createLimiter, aiImageUpload, validate(createSessionSchema), asyncHandler(async (req, res) => {
  const out = await svc.createSession({
    user: req.user, // identity comes from the JWT only; a client-supplied user id is never read
    type: req.body.type, productId: req.body.productId, title: req.body.title, viewHint: req.body.viewHint,
    consent: req.body.consent === true, consentVersion: req.body.consentVersion, image: req.file,
  });
  res.status(out.resumed ? 200 : 201).json(out);
}));

customerRouter.delete('/sessions', asyncHandler(async (req, res) => { res.json(await svc.deleteAll(req.user)); }));

customerRouter.get('/sessions/:id', pollLimiter, validate(uuidParamSchema, 'params'), asyncHandler(async (req, res) => {
  res.json({ session: await svc.getSession(req.user, req.validated.params.id) });
}));

customerRouter.delete('/sessions/:id', validate(uuidParamSchema, 'params'), asyncHandler(async (req, res) => {
  await svc.deleteSession(req.user, req.validated.params.id);
  res.status(204).end();
}));

customerRouter.get('/sessions/:id/messages', pollLimiter, validate(uuidParamSchema, 'params'), asyncHandler(async (req, res) => {
  res.json({ messages: await svc.getMessages(req.user, req.validated.params.id) });
}));

customerRouter.post('/sessions/:id/messages', messageBurst, messageHourly, validate(uuidParamSchema, 'params'), validate(messageBodySchema), asyncHandler(async (req, res) => {
  const out = await svc.sendMessage(req.user, req.validated.params.id, { message: req.body.message, requestId: req.body.requestId });
  res.status(202).json(out);
}));

customerRouter.get('/sessions/:id/versions', pollLimiter, validate(uuidParamSchema, 'params'), asyncHandler(async (req, res) => {
  res.json({ versions: (await svc.getSession(req.user, req.validated.params.id)).versions });
}));

customerRouter.get('/sessions/:id/versions/:versionId', pollLimiter, validate(versionParamsSchema, 'params'), asyncHandler(async (req, res) => {
  const { id, versionId } = req.validated.params;
  const version = (await svc.getSession(req.user, id)).versions.find((v) => v.id === versionId);
  if (!version) throw notFound('Version not found');
  res.json({ version });
}));

customerRouter.post('/sessions/:id/versions/:versionId/restore', validate(versionParamsSchema, 'params'), asyncHandler(async (req, res) => {
  res.json({ session: await svc.restoreVersion(req.user, req.validated.params.id, req.validated.params.versionId) });
}));

customerRouter.post('/sessions/:id/restore-original', validate(uuidParamSchema, 'params'), asyncHandler(async (req, res) => {
  res.json({ session: await svc.restoreOriginal(req.user, req.validated.params.id) });
}));

customerRouter.delete('/sessions/:id/versions/:versionId', validate(versionParamsSchema, 'params'), asyncHandler(async (req, res) => {
  res.json({ session: await svc.deleteVersion(req.user, req.validated.params.id, req.validated.params.versionId) });
}));

customerRouter.post('/sessions/:id/saved', validate(uuidParamSchema, 'params'), validate(saveBodySchema), asyncHandler(async (req, res) => {
  const saved = await svc.saveVersion(req.user, req.validated.params.id, { versionId: req.body.versionId, title: req.body.title });
  res.status(201).json({ saved });
}));

customerRouter.get('/sessions/:id/tryon-methods', validate(uuidParamSchema, 'params'), validate(methodsQuerySchema, 'query'), asyncHandler(async (req, res) => {
  res.json(await svc.getTryOnMethods(req.user, req.validated.params.id, req.validated.query.versionId));
}));

customerRouter.get('/saved', asyncHandler(async (req, res) => { res.json({ items: await svc.listSaved(req.user) }); }));

customerRouter.delete('/saved/:id', validate(uuidParamSchema, 'params'), asyncHandler(async (req, res) => {
  await svc.deleteSaved(req.user, req.validated.params.id);
  res.status(204).end();
}));

/** Mounted at /api/admin/ai. Provider status and aggregate usage only: there is no route that returns a customer's image or chat. */
export const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.get('/overview', asyncHandler(async (_req, res) => { res.json(await svc.adminOverview()); }));
