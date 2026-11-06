import { z } from 'zod';

export const uuidParamSchema = z.object({ id: z.string().uuid('Invalid id') });
export const versionParamsSchema = z.object({ id: z.string().uuid('Invalid id'), versionId: z.string().uuid('Invalid version id') });

/** multipart fields arrive as strings */
export const createSessionSchema = z.object({
  type: z.enum(['product', 'upload']),
  productId: z.coerce.number().int().positive().optional(),
  title: z.string().trim().max(120).optional(),
  viewHint: z.enum(['front', 'back', 'side', 'flat_lay', 'unknown']).optional(),
  consent: z.enum(['true'], { errorMap: () => ({ message: 'Consent is required' }) }).transform(() => true).optional(),
  consentVersion: z.string().trim().max(60).optional().default(''),
}).superRefine((b, ctx) => {
  if (b.type === 'product' && !b.productId) ctx.addIssue({ code: 'custom', path: ['productId'], message: 'Choose a product' });
});

export const listSessionsQuerySchema = z.object({ productId: z.coerce.number().int().positive().optional() });

export const messageBodySchema = z.object({
  message: z.string().trim().min(1, 'Please type a message').max(2000),
  requestId: z.string().uuid('Invalid request id'),
});

export const saveBodySchema = z.object({
  versionId: z.string().uuid().optional(),
  title: z.string().trim().max(120).optional(),
});

export const methodsQuerySchema = z.object({ versionId: z.string().uuid().optional() });

export const assetParamsSchema = z.object({
  which: z.enum(['original', 'version']),
  id: z.string().uuid('Invalid id'),
});

export const assetQuerySchema = z.object({
  exp: z.coerce.number().int().positive(),
  u: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid signature'),
  dl: z.enum(['1']).optional(),
});
