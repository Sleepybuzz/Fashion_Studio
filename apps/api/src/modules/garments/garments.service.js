import crypto from 'node:crypto';
import path from 'node:path';
import { pool, withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { modelFormatFromName } from '../../middleware/upload.js';
import { garmentStore } from '../../storage/index.js';
import { badRequest, notFound } from '../../utils/AppError.js';
import { inspectModelFile } from './glb.js';
import { findConfigProblems, normalizeConfig } from './garments.config.js';
import { COLOR_PRESETS, MATERIAL_PRESETS, colorLabel, materialLabel } from './garments.presets.js';

export const MAX_DESIGNS_PER_USER = 50;
const MIME = { glb: 'model/gltf-binary', gltf: 'model/gltf+json' };
const STORAGE_KEY_RE = /^[0-9a-f-]{36}\.(glb|gltf)$/;

const removeQuiet = (storageKey) => garmentStore.remove(storageKey).catch(() => {});

/** Relative API path the viewer loads the model from. `v` busts caches after a replacement. */
const assetUrl = (a) => `/api/garments/assets/${a.id}/file?v=${a.sha256.slice(0, 12)}`;

const mapAsset = (a) => ({
  id: a.id,
  productId: a.product_id,
  originalName: a.original_name,
  format: a.format,
  sizeBytes: a.size_bytes,
  fileUrl: assetUrl(a),
  modelInfo: a.model_info,
  customizableMaterials: a.customizable_materials || [],
  createdAt: a.created_at,
  updatedAt: a.updated_at,
});

/** Run `fn` and delete the freshly uploaded temp file if it throws. */
async function cleanupOnError(storageKey, fn) {
  try {
    return await fn();
  } catch (err) {
    await removeQuiet(storageKey);
    throw err;
  }
}

// ---------------------------------------------------------------- options

/** Options with their values for a product, ordered. */
export async function getOptions(productId, db = pool) {
  const [opts] = await db.query(
    'SELECT id, option_key, label FROM customization_options WHERE product_id = ? ORDER BY sort_order, id',
    [productId],
  );
  if (!opts.length) return [];
  const [vals] = await db.query(
    `SELECT option_id, value_key, label, show_nodes, hide_nodes FROM customization_values
     WHERE option_id IN (?) ORDER BY sort_order, id`,
    [opts.map((o) => o.id)],
  );
  return opts.map((o) => ({
    key: o.option_key,
    label: o.label,
    values: vals.filter((v) => v.option_id === o.id).map((v) => ({
      key: v.value_key, label: v.label, show: v.show_nodes || [], hide: v.hide_nodes || [],
    })),
  }));
}

/** Names used by options that do not exist in the given node list. */
const missingNodes = (options, nodeNames) => {
  const known = new Set(nodeNames);
  const missing = new Set();
  for (const o of options) for (const v of o.values) for (const n of [...v.show, ...v.hide]) if (!known.has(n)) missing.add(n);
  return [...missing];
};

async function productOrThrow(productId, db = pool) {
  const [rows] = await db.query('SELECT id, name, slug, status FROM products WHERE id = ?', [productId]);
  if (!rows[0]) throw notFound('Product not found');
  return rows[0];
}

async function assetRowByProduct(productId, db = pool) {
  const [rows] = await db.query('SELECT * FROM garment_assets WHERE product_id = ?', [productId]);
  return rows[0] || null;
}

// ---------------------------------------------------------------- admin

/** Every product with its 3D model status (admin list). */
export async function adminList() {
  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.status,
        (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS primary_image,
        a.id AS asset_id, a.original_name, a.size_bytes, a.updated_at AS asset_updated_at,
        (SELECT COUNT(*) FROM customization_options o WHERE o.product_id = p.id) AS option_count
     FROM products p LEFT JOIN garment_assets a ON a.product_id = p.id
     ORDER BY (a.id IS NULL), p.name ASC LIMIT 500`,
  );
  return {
    limits: { maxModelBytes: env.maxModelBytes },
    items: rows.map((r) => ({
      productId: r.id, name: r.name, status: r.status, primaryImage: r.primary_image,
      hasModel: r.asset_id != null, originalName: r.original_name, sizeBytes: r.size_bytes,
      updatedAt: r.asset_updated_at, optionCount: Number(r.option_count),
    })),
  };
}

/** Product + model + options for the admin management screen. */
export async function adminGet(productId) {
  const product = await productOrThrow(productId);
  const asset = await assetRowByProduct(productId);
  return {
    product: { id: product.id, name: product.name, slug: product.slug, status: product.status },
    asset: asset ? mapAsset(asset) : null,
    options: await getOptions(productId),
    limits: { maxModelBytes: env.maxModelBytes },
  };
}

/**
 * Add or replace the 3D model of a product. multer holds the upload in memory; it is written to storage (disk or Bunny) after validation.
 * @param {number} productId
 * @param {import('multer').File} file
 */
export async function saveModel(productId, file) {
  if (!file) throw badRequest('No model file received (field name: model)');
  const format = modelFormatFromName(file.originalname);
  const storageKey = `${crypto.randomUUID()}.${format}`;
  await productOrThrow(productId);
  const info = await inspectModelFile(file.buffer, format);
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  await garmentStore.put(storageKey, file.buffer);
  return cleanupOnError(storageKey, async () => {
    const original = path.basename(file.originalname).replace(/[^\w.\- ()]/g, '_').slice(0, 200);

    const { oldKey, warnings } = await withTransaction(async (conn) => {
      const existing = (await conn.query('SELECT * FROM garment_assets WHERE product_id = ? FOR UPDATE', [productId]))[0][0];
      const keepMaterials = existing
        ? (existing.customizable_materials || []).filter((m) => info.materialNames.includes(m))
        : [];
      if (existing) {
        await conn.query(
          `UPDATE garment_assets SET storage_key = ?, original_name = ?, format = ?, mime_type = ?, size_bytes = ?,
             sha256 = ?, model_info = ?, customizable_materials = ? WHERE id = ?`,
          [storageKey, original, format, MIME[format], file.size, sha256, JSON.stringify(info), JSON.stringify(keepMaterials), existing.id],
        );
      } else {
        await conn.query(
          `INSERT INTO garment_assets (product_id, storage_key, original_name, format, mime_type, size_bytes, sha256, model_info, customizable_materials)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [productId, storageKey, original, format, MIME[format], file.size, sha256, JSON.stringify(info), JSON.stringify([])],
        );
      }
      const gone = missingNodes(await getOptions(productId, conn), info.nodeNames);
      return {
        oldKey: existing?.storage_key,
        warnings: gone.length ? [`Some style options refer to nodes that are not in the new model: ${gone.join(', ')}. Update the options.`] : [],
      };
    });
    if (oldKey && oldKey !== storageKey && STORAGE_KEY_RE.test(oldKey)) await removeQuiet(oldKey);
    return { ...(await adminGet(productId)), warnings };
  });
}

/** Choose which model materials the colour / material controls affect. Empty = all materials. */
export async function updateModelMeta(productId, { customizableMaterials }) {
  const asset = await assetRowByProduct(productId);
  if (!asset) throw notFound('This product has no 3D model');
  const unknown = customizableMaterials.filter((m) => !asset.model_info.materialNames.includes(m));
  if (unknown.length) throw badRequest('Some materials are not in the model', { customizableMaterials: `Unknown: ${unknown.join(', ')}` });
  await pool.query('UPDATE garment_assets SET customizable_materials = ? WHERE id = ?', [
    JSON.stringify([...new Set(customizableMaterials)]), asset.id,
  ]);
  return adminGet(productId);
}

/** Remove the model, its style options and the stored file. Customers' saved designs are kept. */
export async function removeModel(productId) {
  const asset = await assetRowByProduct(productId);
  if (!asset) throw notFound('This product has no 3D model');
  await withTransaction(async (conn) => {
    await conn.query('DELETE FROM customization_options WHERE product_id = ?', [productId]);
    await conn.query('DELETE FROM garment_assets WHERE id = ?', [asset.id]);
  });
  if (STORAGE_KEY_RE.test(asset.storage_key)) await removeQuiet(asset.storage_key);
}

/** Replace all style options of a product (validated against the nodes that exist in its model). */
export async function setOptions(productId, options) {
  const asset = await assetRowByProduct(productId);
  if (!asset) throw badRequest('Upload a 3D model before defining style options');
  const missing = missingNodes(options, asset.model_info.nodeNames);
  if (missing.length) throw badRequest('Some node names do not exist in the model', { options: `Unknown nodes: ${missing.join(', ')}` });
  await withTransaction(async (conn) => {
    await conn.query('DELETE FROM customization_options WHERE product_id = ?', [productId]);
    for (const [oi, o] of options.entries()) {
      const [res] = await conn.query(
        'INSERT INTO customization_options (product_id, option_key, label, sort_order) VALUES (?, ?, ?, ?)',
        [productId, o.key, o.label, oi],
      );
      for (const [vi, v] of o.values.entries()) {
        await conn.query(
          'INSERT INTO customization_values (option_id, value_key, label, show_nodes, hide_nodes, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
          [res.insertId, v.key, v.label, JSON.stringify(v.show), JSON.stringify(v.hide), vi],
        );
      }
    }
  });
  return adminGet(productId);
}

// ---------------------------------------------------------------- file streaming

/**
 * Resolve the stored file for an asset the caller may read.
 * Customers/guests: only models of ACTIVE products. Admin: any status.
 * @returns {Promise<{file:string, mime:string, sha256:string}>}
 */
export async function resolveAssetFile(assetId, { admin = false } = {}) {
  const [rows] = await pool.query(
    `SELECT a.storage_key, a.format, a.sha256, p.status FROM garment_assets a
     JOIN products p ON p.id = a.product_id WHERE a.id = ?`,
    [assetId],
  );
  const a = rows[0];
  if (!a || (!admin && a.status !== 'active') || !STORAGE_KEY_RE.test(a.storage_key)) throw notFound('Model not found');
  return { file: a.storage_key, mime: MIME[a.format], sha256: a.sha256 };
}

/** Delete the stored model file of a product (call after the product row has been deleted). */
export async function unlinkStoredModel(storageKey) {
  if (storageKey && STORAGE_KEY_RE.test(storageKey)) await removeQuiet(storageKey);
}

export async function storageKeyForProduct(productId) {
  const row = await assetRowByProduct(productId);
  return row?.storage_key ?? null;
}

// ---------------------------------------------------------------- public studio

/** Everything the studio page needs for an active product. 404 when there is no model. */
export async function getStudio(slug) {
  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.slug, p.description, p.price, c.name AS category_name,
        (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS primary_image
     FROM products p LEFT JOIN product_categories c ON c.id = p.category_id
     WHERE p.slug = ? AND p.status = 'active' LIMIT 1`,
    [slug],
  );
  const p = rows[0];
  if (!p) throw notFound('Product not found');
  const asset = await assetRowByProduct(p.id);
  if (!asset) throw notFound('This product does not have a 3D model yet');
  const a = mapAsset(asset);
  return {
    product: { id: p.id, name: p.name, slug: p.slug, description: p.description, price: p.price, categoryName: p.category_name, primaryImage: p.primary_image },
    asset: { id: a.id, fileUrl: a.fileUrl, format: a.format, sizeBytes: a.sizeBytes, customizableMaterials: a.customizableMaterials },
    options: await getOptions(p.id),
    colors: COLOR_PRESETS,
    materials: MATERIAL_PRESETS,
  };
}

// ---------------------------------------------------------------- customer designs

const mapDesign = (d, extra = {}) => ({
  id: d.id,
  productId: d.product_id,
  name: d.name,
  config: d.config,
  createdAt: d.created_at,
  updatedAt: d.updated_at,
  ...extra,
});

/** Load a design only if it belongs to `userId`. Others' designs look like "not found". */
async function ownedDesign(id, userId) {
  const [rows] = await pool.query(
    `SELECT d.*, p.name AS product_name, p.slug AS product_slug, p.status AS product_status,
        (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS primary_image,
        (SELECT COUNT(*) FROM garment_assets a WHERE a.product_id = p.id) AS has_model
     FROM garment_customizations d JOIN products p ON p.id = d.product_id
     WHERE d.id = ? AND d.user_id = ?`,
    [id, userId],
  );
  if (!rows[0]) throw notFound('Saved design not found');
  return rows[0];
}

async function describe(row, optionsCache = new Map()) {
  if (!optionsCache.has(row.product_id)) optionsCache.set(row.product_id, await getOptions(row.product_id));
  const options = optionsCache.get(row.product_id);
  const problems = findConfigProblems(row.config, options);
  return mapDesign(row, {
    product: { name: row.product_name, slug: row.product_slug, primaryImage: row.primary_image },
    available: row.product_status === 'active' && Number(row.has_model) > 0,
    outdated: Object.keys(problems).length > 0,
    summary: { color: colorLabel(row.config.colorKey), material: materialLabel(row.config.materialKey) },
  });
}

export async function listDesigns(userId) {
  const [rows] = await pool.query(
    `SELECT d.*, p.name AS product_name, p.slug AS product_slug, p.status AS product_status,
        (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS primary_image,
        (SELECT COUNT(*) FROM garment_assets a WHERE a.product_id = p.id) AS has_model
     FROM garment_customizations d JOIN products p ON p.id = d.product_id
     WHERE d.user_id = ? ORDER BY d.updated_at DESC, d.id DESC LIMIT ?`,
    [userId, MAX_DESIGNS_PER_USER],
  );
  const cache = new Map();
  const out = [];
  for (const row of rows) out.push(await describe(row, cache));
  return out;
}

export async function getDesign(id, userId) {
  return describe(await ownedDesign(id, userId));
}

export async function createDesign(userId, { productId, name, config }) {
  const [prod] = await pool.query("SELECT id FROM products WHERE id = ? AND status = 'active'", [productId]);
  if (!prod[0]) throw notFound('Product not found');
  const asset = await assetRowByProduct(productId);
  if (!asset) throw badRequest('This product does not have a 3D model');
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM garment_customizations WHERE user_id = ?', [userId]);
  if (Number(n) >= MAX_DESIGNS_PER_USER) throw badRequest(`You can keep up to ${MAX_DESIGNS_PER_USER} saved designs. Delete one to save another.`);
  const normalized = normalizeConfig(config, await getOptions(productId));
  const [res] = await pool.query(
    'INSERT INTO garment_customizations (user_id, product_id, asset_id, name, config) VALUES (?, ?, ?, ?, ?)',
    [userId, productId, asset.id, name || 'My design', JSON.stringify(normalized)],
  );
  return getDesign(res.insertId, userId);
}

export async function updateDesign(id, userId, { name, config }) {
  const row = await ownedDesign(id, userId);
  const sets = [];
  const params = [];
  if (name !== undefined) { sets.push('name = ?'); params.push(name); }
  if (config !== undefined) {
    if (row.product_status !== 'active') throw badRequest('This product is no longer available');
    const asset = await assetRowByProduct(row.product_id);
    if (!asset) throw badRequest('This product no longer has a 3D model');
    const normalized = normalizeConfig(config, await getOptions(row.product_id));
    sets.push('config = ?', 'asset_id = ?');
    params.push(JSON.stringify(normalized), asset.id);
  }
  await pool.query(`UPDATE garment_customizations SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...params, id, userId]);
  return getDesign(id, userId);
}

export async function deleteDesign(id, userId) {
  const [res] = await pool.query('DELETE FROM garment_customizations WHERE id = ? AND user_id = ?', [id, userId]);
  if (!res.affectedRows) throw notFound('Saved design not found');
}