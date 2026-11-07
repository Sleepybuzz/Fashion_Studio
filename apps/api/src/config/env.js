import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const API_ROOT = path.resolve(__dirname, '../..');
export const REPO_ROOT = path.resolve(API_ROOT, '../..');

dotenv.config({ path: path.join(API_ROOT, '.env') });

const e = process.env;

/** Read a non-negative integer env var, clamped to [min, max]; blank/invalid values use the default. */
const intEnv = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (value === undefined || String(value).trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
};
const privateRoot = path.join(path.resolve(API_ROOT, e.UPLOAD_DIR || 'uploads'), 'private');

/** Central, validated runtime configuration. */
export const env = {
  nodeEnv: e.NODE_ENV || 'development',
  isProd: e.NODE_ENV === 'production',
  port: Number(e.PORT) || 5000,
  frontendUrl: e.FRONTEND_URL || 'http://localhost:5173',
  // Phase 7: FRONTEND_URL may list several comma-separated origins (e.g. apex + www).
  frontendOrigins: (e.FRONTEND_URL || 'http://localhost:5173').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
  // Phase 7: number of reverse proxies in front of the API (0 = none). Needed so rate limits see real client IPs.
  trustProxy: intEnv(e.TRUST_PROXY, 0, { max: 5 }),
  // Phase 7: coarse per-IP limit over all /api routes (requests per minute). 0 = disabled.
  globalRateLimitPerMinute: intEnv(e.API_RATE_LIMIT_PER_MINUTE, 300, { max: 100000 }),
  dbPoolSize: intEnv(e.DB_POOL_SIZE, 10, { min: 1, max: 100 }),
  requestTimeoutMs: intEnv(e.REQUEST_TIMEOUT_SECONDS, 300, { min: 10, max: 1800 }) * 1000,
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
  // Phase 3: AI photo virtual try-on. The provider API key exists only here (server memory), never in the browser.
  tryon: {
    provider: (e.TRYON_PROVIDER || 'genlook').trim().toLowerCase(),
    genlook: {
      apiKey: (e.GENLOOK_API_KEY || '').trim(),
      baseUrl: (e.GENLOOK_API_BASE_URL || 'https://api.genlook.app/tryon/v1').trim(),
      keepForDays: [1, 3, 7].includes(Number(e.GENLOOK_KEEP_DAYS)) ? Number(e.GENLOOK_KEEP_DAYS) : 1,
      testMode: String(e.GENLOOK_TEST_MODE || '').toLowerCase() === 'true',
      cropPhoto: String(e.GENLOOK_CROP_PHOTO || '').toLowerCase() === 'true',
    },
    // Private storage (never served statically): customer photos, generated results, admin garment photos.
    dir: path.join(privateRoot, 'tryon'),
    // The provider accepts up to 10 MB per image.
    maxPhotoBytes: intEnv(e.MAX_TRYON_PHOTO_MB, 8, { min: 1, max: 10 }) * 1024 * 1024,
    maxGarmentBytes: intEnv(e.MAX_TRYON_GARMENT_MB, 8, { min: 1, max: 10 }) * 1024 * 1024,
    userHourlyLimit: intEnv(e.TRYON_USER_HOURLY_LIMIT, 12, { min: 1, max: 1000 }),
    userDailyLimit: intEnv(e.TRYON_USER_DAILY_LIMIT, 10, { max: 10000 }), // 0 = unlimited
    storeDailyCap: intEnv(e.TRYON_STORE_DAILY_CAP, 200, { max: 1000000 }), // 0 = unlimited
    timeoutMs: intEnv(e.TRYON_TIMEOUT_SECONDS, 240, { min: 30, max: 1800 }) * 1000,
    unsavedRetentionDays: intEnv(e.TRYON_UNSAVED_RETENTION_DAYS, 7, { min: 1, max: 365 }),
    savedRetentionDays: intEnv(e.TRYON_SAVED_RETENTION_DAYS, 90, { min: 1, max: 3650 }),
    signedUrlTtlSeconds: intEnv(e.TRYON_SIGNED_URL_TTL_SECONDS, 1800, { min: 60, max: 86400 }),
  },
  // Phase 4: real-time AR try-on. Body tracking runs in the browser; the server only stores screenshots the
  // customer chooses to save (private storage) and the store owner's transparent garment overlays.
  ar: {
    dir: path.join(privateRoot, 'ar'),
    maxCaptureBytes: intEnv(e.MAX_AR_CAPTURE_MB, 4, { min: 1, max: 10 }) * 1024 * 1024,
    maxOverlayBytes: intEnv(e.MAX_AR_OVERLAY_MB, 4, { min: 1, max: 10 }) * 1024 * 1024,
    retentionDays: intEnv(e.AR_CAPTURE_RETENTION_DAYS, 90, { min: 1, max: 3650 }),
    maxCapturesPerUser: intEnv(e.AR_MAX_CAPTURES_PER_USER, 30, { min: 1, max: 500 }),
    hourlySaveLimit: intEnv(e.AR_CAPTURE_HOURLY_LIMIT, 30, { min: 1, max: 1000 }),
    signedUrlTtlSeconds: intEnv(e.AR_SIGNED_URL_TTL_SECONDS, 1800, { min: 60, max: 86400 }),
  },
  // Phase 5: AI customization. Provider SELECTION lives here; each adapter reads its own credentials/model variables
  // (GEMINI_*, CLOUDFLARE_*, ...) through its `configFromEnv()`, so adding a provider never edits this file.
  // The try-on provider is still selected by TRYON_PROVIDER (Phase 3) above.
  ai: {
    chatProvider: (e.CHAT_AI_PROVIDER || 'gemini').trim().toLowerCase(),
    imageProvider: (e.IMAGE_EDIT_PROVIDER || 'photoroom').trim().toLowerCase(),
    // Private storage (never served statically): the immutable original and every generated version.
    dir: path.join(privateRoot, 'ai'),
    maxUploadBytes: intEnv(e.MAX_AI_UPLOAD_MB, 8, { min: 1, max: 10 }) * 1024 * 1024,
    uploadTypes: (e.AI_UPLOAD_ALLOWED_TYPES || 'image/jpeg,image/png,image/webp').split(',').map((t) => t.trim().toLowerCase())
      .filter((t) => ['image/jpeg', 'image/png', 'image/webp'].includes(t)),
    minSide: intEnv(e.AI_UPLOAD_MIN_SIDE, 256, { min: 64, max: 4000 }),
    // Cost control. 0 = unlimited only for the daily values.
    editUserHourlyLimit: intEnv(e.AI_EDIT_USER_HOURLY_LIMIT, 10, { min: 1, max: 1000 }),
    editUserDailyLimit: intEnv(e.AI_EDIT_USER_DAILY_LIMIT, 20, { max: 100000 }),
    editStoreDailyCap: intEnv(e.AI_EDIT_STORE_DAILY_CAP, 150, { max: 10000000 }),
    chatUserHourlyLimit: intEnv(e.AI_CHAT_USER_HOURLY_LIMIT, 60, { min: 1, max: 10000 }),
    maxSessionsPerUser: intEnv(e.AI_MAX_SESSIONS_PER_USER, 20, { min: 1, max: 500 }),
    maxVersionsPerSession: intEnv(e.AI_MAX_VERSIONS_PER_SESSION, 30, { min: 2, max: 200 }),
    maxSavedPerUser: intEnv(e.AI_MAX_SAVED_PER_USER, 30, { min: 1, max: 500 }),
    maxMessageChars: intEnv(e.AI_MAX_MESSAGE_CHARS, 600, { min: 50, max: 2000 }),
    historyTurns: intEnv(e.AI_CHAT_HISTORY_TURNS, 12, { min: 2, max: 40 }),
    // A generation still unfinished after this many seconds is marked failed (the provider call itself has its own timeout).
    editTimeoutMs: intEnv(e.AI_EDIT_TIMEOUT_SECONDS, 240, { min: 30, max: 1800 }) * 1000,
    unsavedRetentionDays: intEnv(e.AI_UNSAVED_RETENTION_DAYS, 7, { min: 1, max: 365 }),
    savedRetentionDays: intEnv(e.AI_SAVED_RETENTION_DAYS, 90, { min: 1, max: 3650 }),
    signedUrlTtlSeconds: intEnv(e.AI_SIGNED_URL_TTL_SECONDS, 1800, { min: 60, max: 86400 }),
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
  const problems = validateConfig(env);
  if (problems.length) throw new Error(`Invalid configuration:\n - ${problems.join('\n - ')}`);
}
