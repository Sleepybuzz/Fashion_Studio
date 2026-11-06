import fs from 'node:fs/promises';
import path from 'node:path';

const LOCAL_PREFIX = '/uploads/products/';
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Read-only product data for customization. Everything the AI may say about a product (name, sizes, stock, price)
 * comes from here, i.e. from the existing database, never from a model.
 * @param {{pool:any, uploadDir:string, downloadImage:Function, getOptions:(productId:number)=>Promise<any[]>, maxImageBytes:number}} deps
 */
export function createProductSource({ pool, uploadDir, downloadImage, getOptions, maxImageBytes }) {
  return {
    /** Active product with its primary image URL, live variants and 3D availability, or null. */
    async get(productId) {
      const [rows] = await pool.query(
        `SELECT p.id, p.name, p.slug, p.description, p.price, p.status,
           (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS primary_image,
           (SELECT COUNT(*) FROM garment_assets a WHERE a.product_id = p.id) AS has_model
         FROM products p WHERE p.id = ? LIMIT 1`,
        [productId],
      );
      const p = rows[0];
      if (!p) return null;
      const [variants] = await pool.query('SELECT size, color_name, stock_quantity FROM product_variants WHERE product_id = ? ORDER BY id', [productId]);
      return {
        id: p.id, name: p.name, slug: p.slug, description: p.description, price: p.price, status: p.status,
        primaryImage: p.primary_image, has3d: Number(p.has_model) > 0,
        variants: variants.map((v) => ({ size: v.size, colorName: v.color_name, inStock: Number(v.stock_quantity) > 0 })),
      };
    },

    getOptions,

    /** Product flags the unified try-on rules need. */
    async flags(productId, arService) {
      const [[m]] = await pool.query('SELECT COUNT(*) AS n FROM garment_assets WHERE product_id = ?', [productId]);
      const [[t]] = await pool.query(
        `SELECT COUNT(*) AS n FROM product_tryon_configs c
         WHERE c.product_id = ? AND c.enabled = 1 AND EXISTS (SELECT 1 FROM product_tryon_images i WHERE i.product_id = c.product_id)`,
        [productId],
      );
      return { has3d: Number(m.n) > 0, tryOnEligible: Number(t.n) > 0, arEligible: await arService.isEligible(productId) };
    },

    /**
     * Bytes of a product image. Local uploads are read by a validated file name only; remote https images go through
     * the same SSRF-guarded downloader the try-on result download uses.
     * @returns {Promise<Buffer|null>}
     */
    async loadImage(url) {
      if (typeof url !== 'string' || !url) return null;
      if (url.startsWith(LOCAL_PREFIX)) {
        const name = url.slice(LOCAL_PREFIX.length);
        if (!SAFE_NAME.test(name) || name.startsWith('.')) return null;
        try { return await fs.readFile(path.join(uploadDir, 'products', name)); } catch { return null; }
      }
      if (/^https:\/\//i.test(url)) {
        try { return await downloadImage(url, { maxBytes: maxImageBytes }); } catch { return null; }
      }
      return null;
    },
  };
}
