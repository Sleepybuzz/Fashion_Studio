import { z } from 'zod';
import { AI_DESCRIPTION_MAX } from './tryon.constants.js';

export const uuidParamSchema = z.object({ id: z.string().uuid('Invalid id') });

export const createSessionSchema = z.object({
  // Exactly one garment source: a store product, or (Phase 5) a customized design version.
  productId: z.coerce.number({ invalid_type_error: 'Choose a product' }).int().positive('Choose a product').optional(),
  customizationVersionId: z.string().uuid('Invalid design').optional(),
  // multipart fields arrive as strings
  consent: z.enum(['true'], { errorMap: () => ({ message: 'Consent is required' }) }).transform(() => true),
  consentVersion: z.string().trim().min(1, 'Consent version is required').max(30),
}).refine((b) => (b.productId ? 1 : 0) + (b.customizationVersionId ? 1 : 0) === 1, { message: 'Choose a product or a design', path: ['productId'] });

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

export const savedBodySchema = z.object({ saved: z.boolean() });

export const assetParamsSchema = z.object({
  kind: z.enum(['photo', 'result', 'garment']),
  id: z.string().trim().min(1).max(40).regex(/^[0-9a-zA-Z-]+$/, 'Invalid id'),
});

export const assetQuerySchema = z.object({
  exp: z.coerce.number().int().positive(),
  u: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid signature'),
  dl: z.enum(['1']).optional(),
});

// ---- admin
export const productIdParamSchema = z.object({ productId: z.coerce.number().int().positive() });
export const imageParamsSchema = z.object({
  productId: z.coerce.number().int().positive(),
  imageId: z.coerce.number().int().positive(),
});
export const configBodySchema = z.object({
  enabled: z.boolean(),
  aiDescription: z.string().trim().max(AI_DESCRIPTION_MAX, `Keep it under ${AI_DESCRIPTION_MAX} characters`).optional().nullable(),
});

export const customVersionParamSchema = z.object({ versionId: z.string().uuid('Invalid design') });
