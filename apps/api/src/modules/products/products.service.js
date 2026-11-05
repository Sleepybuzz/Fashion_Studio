import { pool, withTransaction } from '../../config/db.js';
import { notFound, badRequest } from '../../utils/AppError.js';
import { uniqueSlug } from '../../utils/slug.js';
import { storageKeyForProduct, unlinkStoredModel } from '../garments/garments.service.js';

const SORTS = {
  newest: 'p.created_at DESC, p.id DESC',
  price_asc: 'p.price ASC, p.id DESC',
  price_desc: 'p.price DESC, p.id DESC',
  name: 'p.name ASC',
};

const mapVariant = (v) => ({
  id: v.id,
  sku: v.sku,
  size: v.size,
  colorName: v.color_name,
  colorHex: v.color_hex,
  priceOverride: v.price_override,
  stockQuantity: v.stock_quantity,
});

const mapProduct = (p) => ({
  id: p.id,
  name: p.name,
  slug: p.slug,
  description: p.description,
  price: p.price,
  compareAtPrice: p.compare_at_price,
  status: p.status,
  isFeatured: !!p.is_featured,
  categoryId: p.category_id,
  categoryName: p.category_name ?? null,
  categorySlug: p.category_slug ?? null,
  totalStock: p.total_stock != null ? Number(p.total_stock) : undefined,
  primaryImage: p.primary_image ?? null,
  createdAt: p.created_at,
});

/**
 * List products. Public callers always get status = 'active'.
 * @param {object} q parsed list query
 * @param {{admin?: boolean}} opts
 */
export async function listProducts(q, { admin = false } = {}) {
  const where = [];
  const params = [];

  if (admin) {
    if (q.status) { where.push('p.status = ?'); params.push(q.status); }
  } else {
    where.push("p.status = 'active'");
  }
  if (q.category) { where.push('c.slug = ?'); params.push(q.category); }
  if (q.featured === 'true') where.push('p.is_featured = 1');
  if (q.q) {
    where.push('(p.name LIKE ? OR p.description LIKE ?)');
    const like = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`;
    params.push(like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM products p LEFT JOIN product_categories c ON c.id = p.category_id ${whereSql}`,
    params,
  );

  const offset = (q.page - 1) * q.limit;
  const [rows] = await pool.query(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
       (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS primary_image,
       (SELECT COALESCE(SUM(v.stock_quantity), 0) FROM product_variants v WHERE v.product_id = p.id) AS total_stock
     FROM products p
     LEFT JOIN product_categories c ON c.id = p.category_id
     ${whereSql}
     ORDER BY ${SORTS[q.sort]}
     LIMIT ? OFFSET ?`,
    [...params, q.limit, offset],
  );

  return {
    items: rows.map(mapProduct),
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}

async function hydrate(row) {
  const [images] = await pool.query(
    'SELECT id, url, alt_text FROM product_images WHERE product_id = ? ORDER BY sort_order, id',
    [row.id],
  );
  const [variants] = await pool.query('SELECT * FROM product_variants WHERE product_id = ? ORDER BY id', [row.id]);
  const [[{ models }]] = await pool.query('SELECT COUNT(*) AS models FROM garment_assets WHERE product_id = ?', [row.id]);
  return {
    ...mapProduct(row),
    has3dModel: Number(models) > 0,
    images: images.map((i) => ({ id: i.id, url: i.url, altText: i.alt_text })),
    variants: variants.map(mapVariant),
  };
}

const BASE_SELECT = `SELECT p.*, c.name AS category_name, c.slug AS category_slug
  FROM products p LEFT JOIN product_categories c ON c.id = p.category_id`;

/** Public lookup by slug (active only). */
export async function getProductBySlug(slug) {
  const [rows] = await pool.query(`${BASE_SELECT} WHERE p.slug = ? AND p.status = 'active' LIMIT 1`, [slug]);
  if (!rows[0]) throw notFound('Product not found');
  return hydrate(rows[0]);
}

/** Admin lookup by id (any status). */
export async function getProductById(id) {
  const [rows] = await pool.query(`${BASE_SELECT} WHERE p.id = ? LIMIT 1`, [id]);
  if (!rows[0]) throw notFound('Product not found');
  return hydrate(rows[0]);
}

async function assertCategory(conn, categoryId) {
  if (!categoryId) return;
  const [rows] = await conn.query('SELECT id FROM product_categories WHERE id = ?', [categoryId]);
  if (!rows[0]) throw badRequest('Selected category does not exist', { categoryId: 'Unknown category' });
}

function assertUniqueSkus(variants) {
  const seen = new Set();
  for (const v of variants) {
    const key = v.sku.toLowerCase();
    if (seen.has(key)) throw badRequest(`Duplicate SKU in variants: ${v.sku}`, { variants: 'SKUs must be unique' });
    seen.add(key);
  }
}

async function writeChildren(conn, productId, { images, variants }) {
  await conn.query('DELETE FROM product_images WHERE product_id = ?', [productId]);
  for (const [idx, img] of images.entries()) {
    await conn.query('INSERT INTO product_images (product_id, url, alt_text, sort_order) VALUES (?, ?, ?, ?)', [
      productId, img.url, img.altText || null, idx,
    ]);
  }
  await conn.query('DELETE FROM product_variants WHERE product_id = ?', [productId]);
  for (const v of variants) {
    await conn.query(
      `INSERT INTO product_variants (product_id, sku, size, color_name, color_hex, price_override, stock_quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [productId, v.sku, v.size || null, v.colorName || null, v.colorHex || null, v.priceOverride ?? null, v.stockQuantity],
    );
  }
}

export async function createProduct(data) {
  assertUniqueSkus(data.variants);
  const id = await withTransaction(async (conn) => {
    await assertCategory(conn, data.categoryId);
    const slug = await uniqueSlug(conn, 'products', data.name);
    const [res] = await conn.query(
      `INSERT INTO products (category_id, name, slug, description, price, compare_at_price, status, is_featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.categoryId ?? null, data.name, slug, data.description || null, data.price,
        data.compareAtPrice ?? null, data.status, data.isFeatured ? 1 : 0],
    );
    await writeChildren(conn, res.insertId, data);
    return res.insertId;
  });
  return getProductById(id);
}

export async function updateProduct(id, data) {
  assertUniqueSkus(data.variants);
  await withTransaction(async (conn) => {
    const [existing] = await conn.query('SELECT id, name, slug FROM products WHERE id = ? FOR UPDATE', [id]);
    if (!existing[0]) throw notFound('Product not found');
    await assertCategory(conn, data.categoryId);
    const slug = existing[0].name === data.name ? existing[0].slug : await uniqueSlug(conn, 'products', data.name, id);
    await conn.query(
      `UPDATE products SET category_id = ?, name = ?, slug = ?, description = ?, price = ?,
         compare_at_price = ?, status = ?, is_featured = ? WHERE id = ?`,
      [data.categoryId ?? null, data.name, slug, data.description || null, data.price,
        data.compareAtPrice ?? null, data.status, data.isFeatured ? 1 : 0, id],
    );
    await writeChildren(conn, id, data);
  });
  return getProductById(id);
}

export async function deleteProduct(id) {
  const modelKey = await storageKeyForProduct(id);
  const [res] = await pool.query('DELETE FROM products WHERE id = ?', [id]);
  if (!res.affectedRows) throw notFound('Product not found');
  // The DB row cascades away; also remove the private model file from disk.
  await unlinkStoredModel(modelKey);
}
