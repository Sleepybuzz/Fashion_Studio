import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { pool } from '../../config/db.js';
import { requireAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { productImageUpload, verifyImageSignature } from '../../middleware/upload.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { badRequest } from '../../utils/AppError.js';

const router = Router();
router.use(requireAdmin);

/** Dashboard overview counts (real data only; orders arrive in Phase 6). */
router.get('/stats', asyncHandler(async (_req, res) => {
  const [[p]] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(status = 'active') AS active, SUM(status = 'draft') AS draft FROM products`,
  );
  const [[c]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role = 'customer'");
  const [[cat]] = await pool.query('SELECT COUNT(*) AS total FROM product_categories');
  const [[s]] = await pool.query('SELECT COALESCE(SUM(stock_quantity), 0) AS units FROM product_variants');
  const [[low]] = await pool.query('SELECT COUNT(*) AS n FROM product_variants WHERE stock_quantity <= 5');
  res.json({
    products: { total: Number(p.total), active: Number(p.active || 0), draft: Number(p.draft || 0) },
    customers: Number(c.total),
    categories: Number(cat.total),
    inventory: { totalUnits: Number(s.units), lowStockVariants: Number(low.n) },
  });
}));

/** Inventory overview: stock per variant. */
router.get('/inventory', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT v.id, v.sku, v.size, v.color_name, v.stock_quantity, p.id AS product_id, p.name AS product_name
     FROM product_variants v JOIN products p ON p.id = v.product_id
     ORDER BY v.stock_quantity ASC, p.name ASC LIMIT 500`,
  );
  res.json({
    items: rows.map((r) => ({
      id: r.id, sku: r.sku, size: r.size, colorName: r.color_name, stockQuantity: r.stock_quantity,
      productId: r.product_id, productName: r.product_name,
    })),
  });
}));

/** Customer list (read-only foundation). */
router.get('/customers', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT id, email, full_name, phone, is_active, created_at FROM users WHERE role = 'customer' ORDER BY created_at DESC LIMIT 500",
  );
  res.json({
    items: rows.map((u) => ({
      id: u.id, email: u.email, fullName: u.full_name, phone: u.phone,
      isActive: !!u.is_active, createdAt: u.created_at,
    })),
  });
}));

const SETTING_KEYS = ['store_name', 'contact_email', 'contact_phone', 'contact_address', 'currency'];
const settingsSchema = z.object({
  store_name: z.string().trim().max(120).optional(),
  contact_email: z.string().trim().email('Enter a valid email').max(255).optional().or(z.literal('')),
  contact_phone: z.string().trim().max(40).optional(),
  contact_address: z.string().trim().max(300).optional(),
  currency: z.string().trim().length(3, 'Use a 3-letter code like INR').toUpperCase().optional(),
});

async function readSettings() {
  const [rows] = await pool.query('SELECT setting_key, setting_value FROM store_settings');
  const out = {};
  for (const k of SETTING_KEYS) out[k] = '';
  for (const r of rows) if (SETTING_KEYS.includes(r.setting_key)) out[r.setting_key] = r.setting_value ?? '';
  return out;
}

router.get('/settings', asyncHandler(async (_req, res) => res.json({ settings: await readSettings() })));

router.put('/settings', validate(settingsSchema), asyncHandler(async (req, res) => {
  for (const [key, value] of Object.entries(req.body)) {
    if (!SETTING_KEYS.includes(key) || value === undefined) continue;
    await pool.query(
      'INSERT INTO store_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      [key, value],
    );
  }
  res.json({ settings: await readSettings() });
}));

/** Product image upload (admin only). Returns a URL to store on the product. */
router.post('/uploads/product-image', (req, res, next) => {
  productImageUpload(req, res, (err) => {
    if (err) return next(err);
    if (!req.file) return next(badRequest('No image file received (field name: image)'));
    if (!verifyImageSignature(req.file.path)) {
      fs.unlink(req.file.path, () => {});
      return next(badRequest('File content is not a valid JPEG, PNG or WebP image'));
    }
    return res.status(201).json({ url: `/uploads/products/${req.file.filename}`, size: req.file.size });
  });
});

export default router;
