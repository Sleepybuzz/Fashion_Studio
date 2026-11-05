import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAdmin } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { idParamSchema, listQuerySchema, productBodySchema } from './products.schemas.js';
import * as svc from './products.service.js';

/** Public catalogue routes: mounted at /api/products */
export const publicRouter = Router();

publicRouter.get('/', validate(listQuerySchema, 'query'), asyncHandler(async (req, res) => {
  res.json(await svc.listProducts(req.validated.query));
}));

publicRouter.get('/:slug', asyncHandler(async (req, res) => {
  res.json({ product: await svc.getProductBySlug(req.params.slug) });
}));

/** Admin product management routes: mounted at /api/admin/products */
export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get('/', validate(listQuerySchema, 'query'), asyncHandler(async (req, res) => {
  res.json(await svc.listProducts(req.validated.query, { admin: true }));
}));

adminRouter.get('/:id', validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  res.json({ product: await svc.getProductById(req.validated.params.id) });
}));

adminRouter.post('/', validate(productBodySchema), asyncHandler(async (req, res) => {
  res.status(201).json({ product: await svc.createProduct(req.body) });
}));

adminRouter.put('/:id', validate(idParamSchema, 'params'), validate(productBodySchema), asyncHandler(async (req, res) => {
  res.json({ product: await svc.updateProduct(req.validated.params.id, req.body) });
}));

adminRouter.delete('/:id', validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  await svc.deleteProduct(req.validated.params.id);
  res.status(204).end();
}));
