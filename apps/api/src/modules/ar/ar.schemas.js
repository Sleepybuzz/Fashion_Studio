import { z } from 'zod';
import { AR_CONSENT_VERSION, ASSET_MODES, GARMENT_TYPES, MAX_CONFIG_BYTES, OFFSET_Y_ADJUST, SCALE_ADJUST } from './ar.constants.js';

export const slugParamSchema = z.object({ slug: z.string().trim().min(1).max(220) });
export const uuidParamSchema = z.object({ id: z.string().uuid('Invalid id') });
export const productIdParamSchema = z.object({ productId: z.coerce.number().int().positive() });

/** The colour / material / style selection that was on screen (same shape as a Phase 2 saved design). */
const configSchema = z.object({
  colorKey: z.string().trim().max(40).nullable().default(null),
  materialKey: z.string().trim().max(40).nullable().default(null),
  options: z.record(z.string().max(40), z.string().max(40)).default({})
    .refine((o) => Object.keys(o).length <= 8, 'Too many options'),
});

export const createCaptureSchema = z.object({
  productId: z.coerce.number({ invalid_type_error: 'Choose a product' }).int().positive('Choose a product'),
  // multipart fields arrive as strings
  consent: z.enum(['true'], { errorMap: () => ({ message: 'Consent is required to save a screenshot' }) }).transform(() => true),
  consentVersion: z.string().trim().min(1, 'Consent version is required').max(30)
    .refine((v) => v === AR_CONSENT_VERSION, 'The consent text has changed. Please reload the page and try again.'),
  config: z.string().max(MAX_CONFIG_BYTES, 'Customization data is too large').optional().transform((raw, ctx) => {
    if (raw === undefined || raw === '') return null;
    let json;
    try { json = JSON.parse(raw); } catch { ctx.addIssue({ code: 'custom', message: 'Invalid customization data' }); return z.NEVER; }
    const parsed = configSchema.safeParse(json);
    if (!parsed.success) { ctx.addIssue({ code: 'custom', message: 'Invalid customization data' }); return z.NEVER; }
    return parsed.data;
  }),
});

export const assetParamsSchema = z.object({ id: z.string().uuid('Invalid id') });
export const assetQuerySchema = z.object({
  exp: z.coerce.number().int().positive(),
  u: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid signature'),
  dl: z.enum(['1']).optional(),
});

// ---- admin
export const adminConfigSchema = z.object({
  enabled: z.boolean(),
  garmentType: z.enum(GARMENT_TYPES),
  assetMode: z.enum(ASSET_MODES),
  scaleAdjust: z.number().min(SCALE_ADJUST.min).max(SCALE_ADJUST.max).transform((n) => Math.round(n * 100) / 100),
  offsetYAdjust: z.number().min(OFFSET_Y_ADJUST.min).max(OFFSET_Y_ADJUST.max).transform((n) => Math.round(n * 100) / 100),
});
