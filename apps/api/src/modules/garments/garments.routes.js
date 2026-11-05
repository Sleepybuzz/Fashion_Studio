import { Router } from 'express';
import { requireAdmin, requireAuth, requireRole } from '../../middleware/auth.js';
import { garmentModelUpload } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { notFound } from '../../utils/AppError.js';
import * as svc from './garments.service.js';
import {
  createDesignSchema, idParamSchema, modelMetaSchema, optionsBodySchema,
  productIdParamSchema, slugParamSchema, updateDesignSchema,
} from './garments.schemas.js';

/** Streams a model file from private storage with safe headers. `file` is a validated storage key. */
function sendModel(res, next, { root, file, mime, sha256 }, cache) {
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cache);
  res.setHeader('ETag', `"${sha256}"`);
  res.sendFile(file, { root, dotfiles: 'deny' }, (err) => {
    if (err && !res.headersSent) next(err.code === 'ENOENT' ? notFound('Model file is missing from storage') : err);
  });
}

/** Mounted at /api/garments (no login: only models of active products are visible). */
export const publicRouter = Router();

publicRouter.get('/studio/:slug', validate(slugParamSchema, 'params'), asyncHandler(async (req, res) => {
  res.json(await svc.getStudio(req.validated.params.slug));
}));

publicRouter.get('/assets/:id/file', validate(idParamSchema, 'params'), asyncHandler(async (req, res, next) => {
  sendModel(res, next, await svc.resolveAssetFile(req.validated.params.id), 'public, max-age=3600');
}));

/** Mounted at /api/customizations — a customer's own saved designs. */
export const customerRouter = Router();
customerRouter.use(requireAuth, requireRole('customer'));

customerRouter.get('/', asyncHandler(async (req, res) => {
  res.json({ items: await svc.listDesigns(req.user.id), maxDesigns: svc.MAX_DESIGNS_PER_USER });
}));

customerRouter.post('/', validate(createDesignSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ design: await svc.createDesign(req.user.id, req.body) });
}));

customerRouter.get('/:id', validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  res.json({ design: await svc.getDesign(req.validated.params.id, req.user.id) });
}));

customerRouter.put('/:id', validate(idParamSchema, 'params'), validate(updateDesignSchema), asyncHandler(async (req, res) => {
  res.json({ design: await svc.updateDesign(req.validated.params.id, req.user.id, req.body) });
}));

customerRouter.delete('/:id', validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  await svc.deleteDesign(req.validated.params.id, req.user.id);
  res.status(204).end();
}));

/** Mounted at /api/admin/garments — store owner only. */
export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get('/', asyncHandler(async (_req, res) => res.json(await svc.adminList())));

adminRouter.get('/product/:productId', validate(productIdParamSchema, 'params'), asyncHandler(async (req, res) => {
  res.json(await svc.adminGet(req.validated.params.productId));
}));

// Upload or replace. Auth runs first (router-level), so unauthenticated callers never reach multer.
adminRouter.put('/product/:productId/model', validate(productIdParamSchema, 'params'), (req, res, next) => {
  garmentModelUpload(req, res, (err) => {
    if (err) return next(err);
    return svc.saveModel(req.validated.params.productId, req.file)
      .then((out) => res.status(200).json(out))
      .catch(next);
  });
});

adminRouter.patch('/product/:productId/model', validate(productIdParamSchema, 'params'), validate(modelMetaSchema), asyncHandler(async (req, res) => {
  res.json(await svc.updateModelMeta(req.validated.params.productId, req.body));
}));

adminRouter.delete('/product/:productId/model', validate(productIdParamSchema, 'params'), asyncHandler(async (req, res) => {
  await svc.removeModel(req.validated.params.productId);
  res.status(204).end();
}));

// Admin preview of any product's model, including drafts (the public route hides non-active products).
adminRouter.get('/product/:productId/model/file', validate(productIdParamSchema, 'params'), asyncHandler(async (req, res, next) => {
  const data = await svc.adminGet(req.validated.params.productId);
  if (!data.asset) return next(notFound('This product has no 3D model'));
  sendModel(res, next, await svc.resolveAssetFile(data.asset.id, { admin: true }), 'private, no-store');
}));

adminRouter.put('/product/:productId/options', validate(productIdParamSchema, 'params'), validate(optionsBodySchema), asyncHandler(async (req, res) => {
  res.json(await svc.setOptions(req.validated.params.productId, req.body.options));
}));
