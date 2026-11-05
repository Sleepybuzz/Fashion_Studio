import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { notFound } from '../../utils/AppError.js';

const router = Router();
router.use(requireAuth);

const idSchema = z.object({ productId: z.coerce.number().int().positive() });

router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.slug, p.price, p.compare_at_price, w.created_at AS added_at,
       (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS primary_image
     FROM wishlist_items w JOIN products p ON p.id = w.product_id
     WHERE w.user_id = ? AND p.status = 'active' ORDER BY w.created_at DESC`,
    [req.user.id],
  );
  res.json({
    items: rows.map((r) => ({
      id: r.id, name: r.name, slug: r.slug, price: r.price,
      compareAtPrice: r.compare_at_price, primaryImage: r.primary_image, addedAt: r.added_at,
    })),
  });
}));

router.get('/ids', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT product_id FROM wishlist_items WHERE user_id = ?', [req.user.id]);
  res.json({ productIds: rows.map((r) => r.product_id) });
}));

router.put('/:productId', validate(idSchema, 'params'), asyncHandler(async (req, res) => {
  const { productId } = req.validated.params;
  const [p] = await pool.query("SELECT id FROM products WHERE id = ? AND status = 'active'", [productId]);
  if (!p[0]) throw notFound('Product not found');
  await pool.query('INSERT IGNORE INTO wishlist_items (user_id, product_id) VALUES (?, ?)', [req.user.id, productId]);
  res.status(204).end();
}));

router.delete('/:productId', validate(idSchema, 'params'), asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM wishlist_items WHERE user_id = ? AND product_id = ?', [
    req.user.id, req.validated.params.productId,
  ]);
  res.status(204).end();
}));

export default router;
