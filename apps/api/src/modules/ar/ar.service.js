import crypto from 'node:crypto';
import { badRequest, notFound } from '../../utils/AppError.js';
import { ImageValidationError, validateImage } from '../tryon/image.inspect.js';
import { imageHasAlpha } from './ar.alpha.js';
import {
  AR_CONSENT_VERSION, AR_ELIGIBLE_SQL, CAPTURE_LIMITS, OFFSET_Y_ADJUST, OVERLAY_LIMITS, OVERLAY_MIMES, SCALE_ADJUST,
} from './ar.constants.js';

const PRIMARY_IMAGE_SQL = '(SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1)';
const FROM_SQL = 'FROM products p JOIN product_ar_configs c ON c.product_id = p.id';
const DAY_MS = 24 * 60 * 60 * 1000;

const safeName = (n) => String(n || 'overlay').replace(/[^\w.\- ()]/g, '_').slice(0, 200);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Relative API path of the public overlay; `v` busts caches after a replacement. */
const overlayUrl = (productId, sha256) => `/api/ar/overlays/${productId}/file?v=${String(sha256).slice(0, 12)}`;

/**
 * Real-time AR try-on business logic (settings, overlays, saved screenshots).
 * Nothing here ever receives camera frames: tracking happens in the browser and only a screenshot the customer
 * explicitly confirmed (with consent) is uploaded. All queries are parameterized and all timestamps come from `now`.
 * @param {{pool:any, withTransaction:Function, storage:any, sign:(kind:string,id:any,userId:number)=>string,
 *   config:{maxCaptureBytes:number,maxOverlayBytes:number,retentionDays:number,maxCapturesPerUser:number},
 *   now?:()=>number, newId?:()=>string}} deps
 */
export function createArService({ pool, withTransaction, storage, sign, config, now = Date.now, newId = () => crypto.randomUUID() }) {
  const one = async (sql, params) => (await pool.query(sql, params))[0][0] || null;

  // ------------------------------------------------------------------ eligibility / public

  /** @returns {Promise<boolean>} */
  async function isEligible(productId) {
    const row = await one(`SELECT p.id ${FROM_SQL} WHERE p.id = ? AND ${AR_ELIGIBLE_SQL} LIMIT 1`, [productId]);
    return !!row;
  }

  /** Everything the AR page needs for an eligible, active product. 404 otherwise (customers never see why). */
  async function getPublicProduct(slug) {
    const r = await one(
      `SELECT p.id, p.name, p.slug, p.price, ${PRIMARY_IMAGE_SQL} AS primary_image,
         c.garment_type, c.asset_mode, c.scale_adjust, c.offset_y_adjust, c.overlay_width, c.overlay_height, c.overlay_sha256
       ${FROM_SQL} WHERE p.slug = ? AND ${AR_ELIGIBLE_SQL} LIMIT 1`,
      [slug],
    );
    if (!r) throw notFound('Real-time AR try-on is not available for this product.');
    return {
      product: { id: r.id, name: r.name, slug: r.slug, price: r.price, primaryImage: r.primary_image },
      ar: {
        garmentType: r.garment_type,
        assetMode: r.asset_mode,
        scaleAdjust: Number(r.scale_adjust),
        offsetYAdjust: Number(r.offset_y_adjust),
        overlay: r.asset_mode === 'overlay2d'
          ? { url: overlayUrl(r.id, r.overlay_sha256), width: r.overlay_width, height: r.overlay_height }
          : null,
      },
      capture: {
        consentVersion: AR_CONSENT_VERSION,
        retentionDays: config.retentionDays,
        maxPerUser: config.maxCapturesPerUser,
      },
    };
  }

  /**
   * File of a product's overlay. Public callers only get overlays of AR-eligible products; admin may preview drafts.
   * @returns {Promise<{key:string, mime:string, sha256:string}>}
   */
  async function resolveOverlayFile(productId, { admin = false } = {}) {
    const r = await one(
      `SELECT c.overlay_key, c.overlay_mime, c.overlay_sha256, (${AR_ELIGIBLE_SQL}) AS eligible
       ${FROM_SQL} WHERE p.id = ?`,
      [productId],
    );
    if (!r || !r.overlay_key || (!admin && !r.eligible)) throw notFound('Overlay not found');
    return { key: r.overlay_key, mime: r.overlay_mime, sha256: r.overlay_sha256 };
  }

  // ------------------------------------------------------------------ customer captures

  const mapCapture = (r, userId) => ({
    id: r.public_id,
    productId: r.product_id,
    product: { name: r.product_name, slug: r.product_slug },
    renderMode: r.render_mode,
    width: r.capture_width,
    height: r.capture_height,
    sizeBytes: r.capture_size,
    config: r.config ?? null,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    imageUrl: sign('arcapture', r.public_id, userId),
  });

  function checkImage(buf, limits, maxBytes) {
    try {
      return validateImage(buf, { ...limits, maxBytes });
    } catch (err) {
      if (err instanceof ImageValidationError) throw badRequest(err.message, { image: err.message });
      throw err;
    }
  }

  /**
   * Save a screenshot the customer confirmed. Identity comes from the authenticated user only.
   * @param {{user:{id:number}, productId:number, file:{buffer:Buffer}|undefined, consentVersion:string, config:object|null}} p
   */
  async function createCapture({ user, productId, file, consentVersion, config: snapshot }) {
    if (!file) throw badRequest('No image received (field name: image)', { image: 'Image is required' });
    const product = await one(
      `SELECT p.id, p.name, p.slug, c.asset_mode ${FROM_SQL} WHERE p.id = ? AND ${AR_ELIGIBLE_SQL} LIMIT 1`,
      [productId],
    );
    if (!product) throw notFound('Real-time AR try-on is not available for this product.');
    const info = checkImage(file.buffer, CAPTURE_LIMITS, config.maxCaptureBytes);

    const key = await storage.save('captures', file.buffer, info.ext);
    const nowMs = now();
    const publicId = newId();
    try {
      await withTransaction(async (conn) => {
        // Lock the customer row so two simultaneous saves cannot both pass the per-customer limit.
        await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
        const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM ar_captures WHERE user_id = ?', [user.id]);
        if (Number(n) >= config.maxCapturesPerUser) {
          throw badRequest(`You can keep up to ${config.maxCapturesPerUser} saved AR screenshots. Delete one to save another.`);
        }
        await conn.query(
          `INSERT INTO ar_captures
             (public_id, user_id, product_id, product_name, product_slug, render_mode, capture_key, capture_mime, capture_size,
              capture_width, capture_height, config, consent_version, consented_at, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [publicId, user.id, product.id, product.name, product.slug, product.asset_mode, key, info.mime, info.size,
            info.width, info.height,
            // Customization only applies to 3D models; never store anything the page did not actually render.
            product.asset_mode === 'model3d' && snapshot ? JSON.stringify(snapshot) : null,
            consentVersion, new Date(nowMs), new Date(nowMs + config.retentionDays * DAY_MS), new Date(nowMs)],
        );
      });
    } catch (err) {
      await storage.remove('captures', key);
      throw err;
    }
    return mapCapture(await one('SELECT * FROM ar_captures WHERE public_id = ?', [publicId]), user.id);
  }

  async function listCaptures(userId) {
    const [rows] = await pool.query('SELECT * FROM ar_captures WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 200', [userId]);
    return { items: rows.map((r) => mapCapture(r, userId)), maxPerUser: config.maxCapturesPerUser, retentionDays: config.retentionDays };
  }

  /** Ownership is part of the query: another customer's id behaves exactly like a missing row. */
  async function deleteCapture(userId, publicId) {
    const row = await one('SELECT id, capture_key FROM ar_captures WHERE public_id = ? AND user_id = ?', [publicId, userId]);
    if (!row) throw notFound('Screenshot not found');
    await pool.query('DELETE FROM ar_captures WHERE id = ? AND user_id = ?', [row.id, userId]);
    await storage.remove('captures', row.capture_key);
  }

  async function deleteAll(userId) {
    const [rows] = await pool.query('SELECT id, capture_key FROM ar_captures WHERE user_id = ?', [userId]);
    for (const r of rows) {
      await pool.query('DELETE FROM ar_captures WHERE id = ? AND user_id = ?', [r.id, userId]);
      await storage.remove('captures', r.capture_key);
    }
    return { deleted: rows.length };
  }

  /** For the signed-URL route: the signature already binds the user; the query re-checks ownership. */
  async function resolveCaptureFile(publicId, userId) {
    const row = await one('SELECT capture_key, capture_mime FROM ar_captures WHERE public_id = ? AND user_id = ?', [publicId, userId]);
    if (!row) throw notFound('Image not found');
    return { key: row.capture_key, mime: row.capture_mime };
  }

  /** Retention enforcement; safe to run repeatedly. */
  async function purgeExpired(limit = 100) {
    let deleted = 0;
    for (;;) {
      const [rows] = await pool.query('SELECT id, capture_key FROM ar_captures WHERE expires_at < ? ORDER BY id LIMIT ?', [new Date(now()), limit]);
      if (!rows.length) break;
      for (const r of rows) {
        await pool.query('DELETE FROM ar_captures WHERE id = ?', [r.id]);
        try { await storage.remove('captures', r.capture_key); } catch (err) { console.warn(`[ar] could not remove capture file: ${err.message}`); }
        deleted += 1;
      }
      if (rows.length < limit) break;
    }
    return { deleted };
  }

  // ------------------------------------------------------------------ admin

  const assertProduct = async (productId) => {
    const row = await one('SELECT id, name, slug, status FROM products WHERE id = ?', [productId]);
    if (!row) throw notFound('Product not found');
    return row;
  };

  const hasModel = async (productId) => !!(await one('SELECT id FROM garment_assets WHERE product_id = ?', [productId]));

  const mapOverlay = (c) => (c?.overlay_key
    ? { name: c.overlay_name, mime: c.overlay_mime, sizeBytes: c.overlay_size, width: c.overlay_width, height: c.overlay_height }
    : null);

  async function adminList() {
    const [rows] = await pool.query(
      `SELECT p.id, p.name, p.status, ${PRIMARY_IMAGE_SQL} AS primary_image,
         c.product_id AS has_cfg, COALESCE(c.enabled, 0) AS enabled, c.asset_mode, c.garment_type, c.overlay_key,
         EXISTS (SELECT 1 FROM garment_assets a WHERE a.product_id = p.id) AS has_model,
         (c.product_id IS NOT NULL AND ${AR_ELIGIBLE_SQL}) AS eligible
       FROM products p LEFT JOIN product_ar_configs c ON c.product_id = p.id
       ORDER BY p.name ASC LIMIT 500`,
    );
    return rows.map((r) => ({
      productId: r.id, name: r.name, status: r.status, primaryImage: r.primary_image,
      enabled: !!r.enabled, assetMode: r.asset_mode || 'model3d', garmentType: r.garment_type || 'top',
      hasModel: !!r.has_model, hasOverlay: !!r.overlay_key, eligible: !!r.eligible,
    }));
  }

  async function adminGet(productId) {
    const p = await assertProduct(productId);
    const c = await one('SELECT * FROM product_ar_configs WHERE product_id = ?', [productId]);
    const model = await hasModel(productId);
    const mode = c?.asset_mode || 'model3d';
    const hasAsset = mode === 'model3d' ? model : !!c?.overlay_key;
    return {
      product: { id: p.id, name: p.name, slug: p.slug, status: p.status },
      config: {
        enabled: !!c?.enabled,
        garmentType: c?.garment_type || 'top',
        assetMode: mode,
        scaleAdjust: c ? Number(c.scale_adjust) : SCALE_ADJUST.default,
        offsetYAdjust: c ? Number(c.offset_y_adjust) : OFFSET_Y_ADJUST.default,
      },
      hasModel: model,
      overlay: mapOverlay(c),
      eligible: p.status === 'active' && !!c?.enabled && hasAsset,
      limits: { maxOverlayBytes: config.maxOverlayBytes, minSide: OVERLAY_LIMITS.minSide, maxSide: OVERLAY_LIMITS.maxSide },
    };
  }

  async function saveConfig(productId, { enabled, garmentType, assetMode, scaleAdjust, offsetYAdjust }) {
    await assertProduct(productId);
    if (enabled) {
      const c = await one('SELECT overlay_key FROM product_ar_configs WHERE product_id = ?', [productId]);
      if (assetMode === 'model3d' && !(await hasModel(productId))) {
        throw badRequest('Upload a 3D model for this product (3D assets) before enabling AR with a 3D model.', { assetMode: 'No 3D model yet' });
      }
      if (assetMode === 'overlay2d' && !c?.overlay_key) {
        throw badRequest('Upload a transparent overlay image before enabling AR with a 2D overlay.', { assetMode: 'No overlay yet' });
      }
    }
    await pool.query(
      `INSERT INTO product_ar_configs (product_id, enabled, garment_type, asset_mode, scale_adjust, offset_y_adjust)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), garment_type = VALUES(garment_type), asset_mode = VALUES(asset_mode),
         scale_adjust = VALUES(scale_adjust), offset_y_adjust = VALUES(offset_y_adjust)`,
      [productId, enabled ? 1 : 0, garmentType, assetMode, scaleAdjust, offsetYAdjust],
    );
  }

  async function saveOverlay(productId, file) {
    await assertProduct(productId);
    if (!file) throw badRequest('No image received (field name: overlay)', { overlay: 'Image is required' });
    const info = checkImage(file.buffer, OVERLAY_LIMITS, config.maxOverlayBytes);
    if (!OVERLAY_MIMES.includes(info.mime)) {
      throw badRequest('The overlay must be a PNG or WebP image with a transparent background (JPEG cannot be transparent).', { overlay: 'PNG or WebP required' });
    }
    if (!imageHasAlpha(file.buffer, info.mime)) {
      throw badRequest('This image has no transparency. Export the garment on a transparent background (cut out, no backdrop).', { overlay: 'No transparent background' });
    }
    const old = await one('SELECT overlay_key FROM product_ar_configs WHERE product_id = ?', [productId]);
    const key = await storage.save('overlays', file.buffer, info.ext);
    try {
      await pool.query(
        `INSERT INTO product_ar_configs (product_id, overlay_key, overlay_name, overlay_mime, overlay_size, overlay_width, overlay_height, overlay_sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE overlay_key = VALUES(overlay_key), overlay_name = VALUES(overlay_name), overlay_mime = VALUES(overlay_mime),
           overlay_size = VALUES(overlay_size), overlay_width = VALUES(overlay_width), overlay_height = VALUES(overlay_height),
           overlay_sha256 = VALUES(overlay_sha256)`,
        [productId, key, safeName(file.originalname), info.mime, info.size, info.width, info.height, sha(file.buffer)],
      );
    } catch (err) {
      await storage.remove('overlays', key);
      throw err;
    }
    if (old?.overlay_key) await storage.remove('overlays', old.overlay_key);
  }

  /** @returns {Promise<{autoDisabled:boolean}>} */
  async function removeOverlay(productId) {
    const c = await one('SELECT overlay_key, asset_mode, enabled FROM product_ar_configs WHERE product_id = ?', [productId]);
    if (!c?.overlay_key) throw notFound('This product has no overlay image');
    const autoDisabled = c.asset_mode === 'overlay2d' && !!c.enabled;
    await pool.query(
      `UPDATE product_ar_configs SET overlay_key = NULL, overlay_name = NULL, overlay_mime = NULL, overlay_size = NULL,
         overlay_width = NULL, overlay_height = NULL, overlay_sha256 = NULL, enabled = IF(asset_mode = 'overlay2d', 0, enabled)
       WHERE product_id = ?`,
      [productId],
    );
    await storage.remove('overlays', c.overlay_key);
    return { autoDisabled };
  }

  /** Overlay file keys of a product (call BEFORE deleting the product; rows cascade away). */
  async function collectOverlayKeys(productId) {
    const c = await one('SELECT overlay_key FROM product_ar_configs WHERE product_id = ?', [productId]);
    return c?.overlay_key ? [c.overlay_key] : [];
  }

  async function removeStoredOverlayKeys(keys) {
    for (const k of keys) await storage.remove('overlays', k);
  }

  return {
    isEligible, getPublicProduct, resolveOverlayFile,
    createCapture, listCaptures, deleteCapture, deleteAll, resolveCaptureFile, purgeExpired,
    adminList, adminGet, saveConfig, saveOverlay, removeOverlay, collectOverlayKeys, removeStoredOverlayKeys,
  };
}
