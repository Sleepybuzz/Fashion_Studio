import { Router } from 'express';
import { pool } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** Public store info for the footer/contact page: GET /api/store-info */
const router = Router();
const PUBLIC_KEYS = ['store_name', 'contact_email', 'contact_phone', 'contact_address', 'currency'];

router.get('/', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query('SELECT setting_key, setting_value FROM store_settings WHERE setting_key IN (?)', [PUBLIC_KEYS]);
  const info = {};
  for (const r of rows) info[r.setting_key] = r.setting_value;
  res.json({
    storeName: info.store_name || 'AI Fashion Studio',
    contactEmail: info.contact_email || '',
    contactPhone: info.contact_phone || '',
    contactAddress: info.contact_address || '',
    currency: info.currency || 'INR',
  });
}));

export default router;
