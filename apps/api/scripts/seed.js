import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { pool } from '../src/config/db.js';
import { slugify } from '../src/utils/slug.js';

/**
 * Safe, idempotent seeding.
 * - Accounts come ONLY from SEED_* variables in apps/api/.env (nothing hardcoded).
 * - Existing rows are never overwritten or deleted.
 * - Sample catalogue is inserted only when the products table is empty and NODE_ENV is not production.
 */

const CATEGORIES = [
  ['Tops', 'Shirts, tees and knitwear'],
  ['Bottoms', 'Trousers, denim and skirts'],
  ['Outerwear', 'Jackets and coats'],
  ['Dresses', 'Everyday and occasion dresses'],
  ['Accessories', 'Scarves, belts and more'],
];

// Sample catalogue for local development only. No images: the UI shows neutral placeholders.
const SAMPLE_PRODUCTS = [
  { name: 'Classic Cotton Shirt', category: 'Tops', price: 1799, featured: true, desc: 'A crisp everyday shirt in breathable cotton.' },
  { name: 'Relaxed Linen Tee', category: 'Tops', price: 999, featured: false, desc: 'Soft, lightweight tee with a relaxed fit.' },
  { name: 'Tailored Chino Trousers', category: 'Bottoms', price: 2199, featured: true, desc: 'Slim-tapered chinos with a clean finish.' },
  { name: 'Straight Fit Denim', category: 'Bottoms', price: 2499, featured: false, desc: 'Mid-weight denim in a straight silhouette.' },
  { name: 'Wool Blend Overcoat', category: 'Outerwear', price: 6999, featured: true, desc: 'A structured overcoat for cooler days.' },
  { name: 'Midi Wrap Dress', category: 'Dresses', price: 3299, featured: true, desc: 'Flowing wrap dress with an adjustable waist.' },
];
const SIZES = ['S', 'M', 'L'];

async function upsertUser(label, email, password, fullName, role) {
  if (!email || !password) {
    console.log(`[seed] ${label}: SEED_${label.toUpperCase()}_EMAIL/PASSWORD not set, skipping.`);
    return;
  }
  if (password.length < 8) {
    console.error(`[seed] ${label}: password must be at least 8 characters, skipping.`);
    return;
  }
  if (env.isProd && password.length < 12) {
    console.error(`[seed] ${label}: in production use a password of 12+ characters, skipping.`);
    return;
  }
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
  if (rows.length) {
    console.log(`[seed] ${label}: account already exists, left unchanged.`);
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.query('INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)', [
    email.toLowerCase(), hash, fullName, role,
  ]);
  console.log(`[seed] ${label}: account created.`);
}

async function seedCatalogue() {
  const ids = {};
  for (const [i, [name, description]] of CATEGORIES.entries()) {
    await pool.query(
      'INSERT IGNORE INTO product_categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)',
      [name, slugify(name), description, i],
    );
    const [r] = await pool.query('SELECT id FROM product_categories WHERE name = ?', [name]);
    ids[name] = r[0].id;
  }
  console.log('[seed] categories ready.');

  if (env.isProd) return console.log('[seed] production: sample products skipped.');
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM products');
  if (n > 0) return console.log('[seed] products already exist, sample products skipped.');

  for (const p of SAMPLE_PRODUCTS) {
    const slug = slugify(p.name);
    const [res] = await pool.query(
      "INSERT INTO products (category_id, name, slug, description, price, status, is_featured) VALUES (?, ?, ?, ?, ?, 'active', ?)",
      [ids[p.category], p.name, slug, p.desc, p.price, p.featured ? 1 : 0],
    );
    for (const size of SIZES) {
      await pool.query(
        'INSERT INTO product_variants (product_id, sku, size, color_name, color_hex, stock_quantity) VALUES (?, ?, ?, ?, ?, ?)',
        [res.insertId, `${slug.toUpperCase().slice(0, 18)}-${size}`, size, 'Natural', '#D8CFC4', 10],
      );
    }
  }
  console.log(`[seed] ${SAMPLE_PRODUCTS.length} sample products created.`);
}

try {
  await seedCatalogue();
  await upsertUser('admin', env.seed.adminEmail, env.seed.adminPassword, 'Store Owner', 'admin');
  await upsertUser('customer', env.seed.customerEmail, env.seed.customerPassword, 'Sample Customer', 'customer');
  console.log('[seed] finished.');
} catch (err) {
  console.error('[seed] failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
