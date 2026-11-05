import { z } from 'zod';

const slugKey = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Use lowercase letters, numbers and hyphens (max 40)');
const nodeName = z.string().trim().min(1).max(100);

export const productIdParamSchema = z.object({ productId: z.coerce.number().int().positive() });
export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
export const slugParamSchema = z.object({ slug: z.string().trim().min(1).max(220) });

const configSchema = z.object({
  colorKey: z.string().trim().max(40).nullable().default(null),
  materialKey: z.string().trim().max(40).nullable().default(null),
  options: z.record(z.string().max(40), z.string().max(40)).default({})
    .refine((o) => Object.keys(o).length <= 8, 'Too many options'),
});

const designName = z.string().trim().min(1, 'Name is required').max(80);

export const createDesignSchema = z.object({
  productId: z.coerce.number().int().positive(),
  name: designName.optional(),
  config: configSchema,
});

export const updateDesignSchema = z.object({
  name: designName.optional(),
  config: configSchema.optional(),
}).refine((b) => b.name !== undefined || b.config !== undefined, 'Nothing to update');

export const modelMetaSchema = z.object({
  customizableMaterials: z.array(z.string().trim().min(1).max(200)).max(100),
});

const optionValueSchema = z.object({
  key: slugKey,
  label: z.string().trim().min(1, 'Label is required').max(60),
  show: z.array(nodeName).max(50).default([]),
  hide: z.array(nodeName).max(50).default([]),
}).refine((v) => v.show.length + v.hide.length > 0, 'Each value must show or hide at least one model node')
  .refine((v) => !v.show.some((n) => v.hide.includes(n)), 'A node cannot be both shown and hidden by the same value');

const optionSchema = z.object({
  key: slugKey,
  label: z.string().trim().min(1, 'Label is required').max(60),
  values: z.array(optionValueSchema).min(2, 'An option needs at least two values').max(12),
}).refine((o) => new Set(o.values.map((v) => v.key)).size === o.values.length, 'Value keys must be unique within an option');

export const optionsBodySchema = z.object({
  options: z.array(optionSchema).max(8, 'At most 8 options per product'),
}).refine((b) => new Set(b.options.map((o) => o.key)).size === b.options.length, 'Option keys must be unique');
