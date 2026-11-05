import crypto from 'node:crypto';
import { badRequest, notFound } from '../../utils/AppError.js';
import { IMAGE_LIMITS } from './tryon.constants.js';
import { ImageValidationError, validateImage } from './image.inspect.js';

const PRODUCT_SELECT = `SELECT p.id, p.name, p.slug, p.description, p.status,
    (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS primary_image,
    COALESCE(c.enabled, 0) AS enabled, c.ai_description
  FROM products p LEFT JOIN product_tryon_configs c ON c.product_id = p.id`;

const mapImage = (r) => ({
  id: r.id, storageKey: r.storage_key, originalName: r.original_name, mimeType: r.mime_type,
  sizeBytes: r.size_bytes, width: r.width, height: r.height, sha256: r.sha256,
});

/**
 * Product-side data for virtual try-on: per-product settings and the AI-ready garment photos.
 * Used by the customer flow (read-only) and by the admin screens (management).
 * @param {{pool:any, withTransaction:Function, storage:any, sign:(kind:string,id:any,userId:number)=>string, maxGarmentBytes:number}} deps
 */
export function createTryOnCatalog({ pool, withTransaction, storage, sign, maxGarmentBytes }) {
  async function load(where, param) {
    const [rows] = await pool.query(`${PRODUCT_SELECT} WHERE ${where} LIMIT 1`, [param]);
    const p = rows[0];
    if (!p) return null;
    const [imgs] = await pool.query(
      'SELECT * FROM product_tryon_images WHERE product_id = ? ORDER BY sort_order, id',
      [p.id],
    );
    return {
      product: { id: p.id, name: p.name, slug: p.slug, description: p.description, status: p.status, primaryImage: p.primary_image },
      config: { enabled: !!p.enabled, aiDescription: p.ai_description ?? null },
      images: imgs.map(mapImage),
    };
  }

  function checkImage(file) {
    try {
      return validateImage(file?.buffer, { ...IMAGE_LIMITS.garment, maxBytes: maxGarmentBytes });
    } catch (err) {
      if (err instanceof ImageValidationError) throw badRequest(err.message, { image: err.message });
      throw err;
    }
  }

  const safeName = (n) => String(n || 'garment').replace(/[^\w.\- ()]/g, '_').slice(0, 200);
  const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

  const assertProduct = async (productId) => {
    const [rows] = await pool.query('SELECT id FROM products WHERE id = ?', [productId]);
    if (!rows[0]) throw notFound('Product not found');
  };

  return {
    /** Active products only (what a customer may see). */
    getBySlug: (slug) => load("p.slug = ? AND p.status = 'active'", slug),
    /** Any status (used for validation at submit time and by the admin). */
    getById: (id) => load('p.id = ?', id),

    /** Look up a garment photo for the signed-URL route. */
    async getImageFile(imageId) {
      const [rows] = await pool.query('SELECT storage_key, mime_type FROM product_tryon_images WHERE id = ?', [imageId]);
      return rows[0] ? { key: rows[0].storage_key, mime: rows[0].mime_type } : null;
    },

    // ------------------------------------------------------------ admin
    async adminList() {
      const [rows] = await pool.query(
        `SELECT p.id, p.name, p.status,
           (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS primary_image,
           COALESCE(c.enabled, 0) AS enabled,
           (SELECT COUNT(*) FROM product_tryon_images t WHERE t.product_id = p.id) AS image_count
         FROM products p LEFT JOIN product_tryon_configs c ON c.product_id = p.id
         ORDER BY p.name ASC LIMIT 500`,
      );
      return rows.map((r) => ({
        productId: r.id, name: r.name, status: r.status, primaryImage: r.primary_image,
        enabled: !!r.enabled, imageCount: Number(r.image_count),
        eligible: r.status === 'active' && !!r.enabled && Number(r.image_count) > 0,
      }));
    },

    async adminGet(productId, adminUserId) {
      const data = await load('p.id = ?', productId);
      if (!data) throw notFound('Product not found');
      const eligible = data.product.status === 'active' && data.config.enabled && data.images.length > 0;
      return {
        product: { id: data.product.id, name: data.product.name, slug: data.product.slug, status: data.product.status, description: data.product.description },
        config: data.config,
        eligible,
        images: data.images.map((i) => ({
          id: i.id, originalName: i.originalName, width: i.width, height: i.height, sizeBytes: i.sizeBytes,
          url: sign('garment', i.id, adminUserId),
        })),
        limits: { maxImages: IMAGE_LIMITS.garment.maxPerProduct, maxBytes: maxGarmentBytes, minSide: IMAGE_LIMITS.garment.minSide },
      };
    },

    async saveConfig(productId, { enabled, aiDescription }) {
      await assertProduct(productId);
      if (enabled) {
        const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM product_tryon_images WHERE product_id = ?', [productId]);
        if (!Number(n)) throw badRequest('Upload at least one garment photo before enabling virtual try-on.', { enabled: 'No garment photo yet' });
      }
      await pool.query(
        `INSERT INTO product_tryon_configs (product_id, enabled, ai_description) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), ai_description = VALUES(ai_description)`,
        [productId, enabled ? 1 : 0, aiDescription || null],
      );
    },

    async addImage(productId, file) {
      await assertProduct(productId);
      const info = checkImage(file);
      const key = await storage.save('garments', file.buffer, info.ext);
      try {
        await withTransaction(async (conn) => {
          const [[{ n, maxOrder }]] = await conn.query(
            'SELECT COUNT(*) AS n, COALESCE(MAX(sort_order), -1) AS maxOrder FROM product_tryon_images WHERE product_id = ? FOR UPDATE',
            [productId],
          );
          if (Number(n) >= IMAGE_LIMITS.garment.maxPerProduct) {
            throw badRequest(`A product can have at most ${IMAGE_LIMITS.garment.maxPerProduct} garment photos.`);
          }
          await conn.query(
            `INSERT INTO product_tryon_images (product_id, storage_key, original_name, mime_type, size_bytes, width, height, sha256, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [productId, key, safeName(file.originalname), info.mime, info.size, info.width, info.height, sha(file.buffer), Number(maxOrder) + 1],
          );
        });
      } catch (err) {
        await storage.remove('garments', key);
        throw err;
      }
    },

    async replaceImage(productId, imageId, file) {
      const [rows] = await pool.query('SELECT * FROM product_tryon_images WHERE id = ? AND product_id = ?', [imageId, productId]);
      if (!rows[0]) throw notFound('Garment photo not found');
      const info = checkImage(file);
      const key = await storage.save('garments', file.buffer, info.ext);
      try {
        await pool.query(
          `UPDATE product_tryon_images SET storage_key = ?, original_name = ?, mime_type = ?, size_bytes = ?, width = ?, height = ?, sha256 = ?
           WHERE id = ?`,
          [key, safeName(file.originalname), info.mime, info.size, info.width, info.height, sha(file.buffer), imageId],
        );
      } catch (err) {
        await storage.remove('garments', key);
        throw err;
      }
      await storage.remove('garments', rows[0].storage_key);
    },

    /** @returns {Promise<{autoDisabled:boolean}>} */
    async removeImage(productId, imageId) {
      const [rows] = await pool.query('SELECT storage_key FROM product_tryon_images WHERE id = ? AND product_id = ?', [imageId, productId]);
      if (!rows[0]) throw notFound('Garment photo not found');
      await pool.query('DELETE FROM product_tryon_images WHERE id = ?', [imageId]);
      await storage.remove('garments', rows[0].storage_key);
      const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM product_tryon_images WHERE product_id = ?', [productId]);
      if (Number(n) === 0) {
        const [res] = await pool.query('UPDATE product_tryon_configs SET enabled = 0 WHERE product_id = ? AND enabled = 1', [productId]);
        return { autoDisabled: res.affectedRows > 0 };
      }
      return { autoDisabled: false };
    },

    /** Storage keys of a product's garment photos (call BEFORE deleting the product; rows cascade away). */
    async collectImageKeys(productId) {
      const [rows] = await pool.query('SELECT storage_key FROM product_tryon_images WHERE product_id = ?', [productId]);
      return rows.map((r) => r.storage_key);
    },

    async removeStoredKeys(keys) {
      for (const k of keys) await storage.remove('garments', k);
    },
  };
}
