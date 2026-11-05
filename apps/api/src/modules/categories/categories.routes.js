import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../config/db.js';
import { requireAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { conflict, notFound } from '../../utils/AppError.js';
import { uniqueSlug } from '../../utils/slug.js';

const map = (c) => ({
  id: c.id, name: c.name, slug: c.slug, description: c.description,
  sortOrder: c.sort_order, productCount: c.product_count != null ? Number(c.product_count) : undefined,
});

const bodySchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(100),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
});
const idSchema = z.object({ id: z.coerce.number().int().positive() });

const LIST_SQL = `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status = 'active') AS product_count
  FROM product_categories c ORDER BY c.sort_order, c.name`;

/** Public: GET /api/categories */
export const publicRouter = Router();
publicRouter.get('/', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(LIST_SQL);
  res.json({ items: rows.map(map) });
}));

/** Admin: /api/admin/categories */
export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get('/', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(LIST_SQL);
  res.json({ items: rows.map(map) });
}));

adminRouter.post('/', validate(bodySchema), asyncHandler(async (req, res) => {
  const [dupe] = await pool.query('SELECT id FROM product_categories WHERE name = ?', [req.body.name]);
  if (dupe.length) throw conflict('A category with this name already exists');
  const slug = await uniqueSlug(pool, 'product_categories', req.body.name);
  const [r] = await pool.query(
    'INSERT INTO product_categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)',
    [req.body.name, slug, req.body.description || null, req.body.sortOrder],
  );
  const [rows] = await pool.query('SELECT * FROM product_categories WHERE id = ?', [r.insertId]);
  res.status(201).json({ category: map(rows[0]) });
}));

adminRouter.put('/:id', validate(idSchema, 'params'), validate(bodySchema), asyncHandler(async (req, res) => {
  const { id } = req.validated.params;
  const [cur] = await pool.query('SELECT * FROM product_categories WHERE id = ?', [id]);
  if (!cur[0]) throw notFound('Category not found');
  const [dupe] = await pool.query('SELECT id FROM product_categories WHERE name = ? AND id <> ?', [req.body.name, id]);
  if (dupe.length) throw conflict('A category with this name already exists');
  const slug = cur[0].name === req.body.name ? cur[0].slug : await uniqueSlug(pool, 'product_categories', req.body.name, id);
  await pool.query('UPDATE product_categories SET name = ?, slug = ?, description = ?, sort_order = ? WHERE id = ?', [
    req.body.name, slug, req.body.description || null, req.body.sortOrder, id,
  ]);
  const [rows] = await pool.query('SELECT * FROM product_categories WHERE id = ?', [id]);
  res.json({ category: map(rows[0]) });
}));

adminRouter.delete('/:id', validate(idSchema, 'params'), asyncHandler(async (req, res) => {
  const [r] = await pool.query('DELETE FROM product_categories WHERE id = ?', [req.validated.params.id]);
  if (!r.affectedRows) throw notFound('Category not found');
  res.status(204).end();
}));
