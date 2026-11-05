import { z } from 'zod';

const money = z.coerce.number({ invalid_type_error: 'Enter a valid amount' }).min(0, 'Must be 0 or more').max(9999999.99);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #1A2B3C');

export const variantSchema = z.object({
  sku: z.string().trim().min(1, 'SKU is required').max(80),
  size: z.string().trim().max(20).optional().nullable(),
  colorName: z.string().trim().max(50).optional().nullable(),
  colorHex: hex.optional().nullable().or(z.literal('').transform(() => null)),
  priceOverride: money.optional().nullable(),
  stockQuantity: z.coerce.number().int('Must be a whole number').min(0).max(1000000),
});

const imageUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith('/uploads/') || /^https:\/\//.test(v), 'Image must be an uploaded file or an https URL');

export const productBodySchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(200),
  description: z.string().trim().max(5000).optional().nullable(),
  price: money,
  compareAtPrice: money.optional().nullable(),
  categoryId: z.coerce.number().int().positive().optional().nullable(),
  status: z.enum(['draft', 'active', 'archived']).default('active'),
  isFeatured: z.boolean().default(false),
  images: z.array(z.object({ url: imageUrl, altText: z.string().trim().max(200).optional().nullable() })).max(10).default([]),
  variants: z.array(variantSchema).max(100).default([]),
});

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(120).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'name']).default('newest'),
  featured: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(12),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
