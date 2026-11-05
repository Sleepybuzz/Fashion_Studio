import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const API_ROOT = path.resolve(__dirname, '../..');
export const REPO_ROOT = path.resolve(API_ROOT, '../..');

dotenv.config({ path: path.join(API_ROOT, '.env') });

const e = process.env;

/** Central, validated runtime configuration. */
export const env = {
  nodeEnv: e.NODE_ENV || 'development',
  isProd: e.NODE_ENV === 'production',
  port: Number(e.PORT) || 5000,
  frontendUrl: e.FRONTEND_URL || 'http://localhost:5173',
  db: {
    host: e.DB_HOST || 'localhost',
    port: Number(e.DB_PORT) || 3306,
    user: e.DB_USER || '',
    password: e.DB_PASSWORD || '',
    database: e.DB_NAME || 'ai_fashion_studio',
  },
  jwtSecret: e.JWT_SECRET || '',
  jwtExpiresIn: e.JWT_EXPIRES_IN || '7d',
  storageDriver: e.STORAGE_DRIVER || 'local',
  uploadDir: path.resolve(API_ROOT, e.UPLOAD_DIR || 'uploads'),
  maxUploadBytes: (Number(e.MAX_UPLOAD_MB) || 5) * 1024 * 1024,
  // Phase 2: private storage for 3D garment models (never served statically).
  privateDir: path.join(path.resolve(API_ROOT, e.UPLOAD_DIR || 'uploads'), 'private'),
  maxModelBytes: (Number(e.MAX_MODEL_MB) || 25) * 1024 * 1024,
  seed: {
    adminEmail: e.SEED_ADMIN_EMAIL || '',
    adminPassword: e.SEED_ADMIN_PASSWORD || '',
    customerEmail: e.SEED_CUSTOMER_EMAIL || '',
    customerPassword: e.SEED_CUSTOMER_PASSWORD || '',
  },
};

/**
 * Validate variables the server cannot run without.
 * @throws {Error} with a clear message listing what is missing.
 */
export function assertServerConfig() {
  const missing = [];
  if (!env.db.user) missing.push('DB_USER');
  if (!env.jwtSecret) missing.push('JWT_SECRET');
  if (missing.length) {
    throw new Error(`Missing required environment variables in apps/api/.env: ${missing.join(', ')}`);
  }
  if (env.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long.');
  }
}
