import { pool, withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { createTryOnStorage } from '../tryon/tryon.storage.js';
import { deriveSigningKey, signAsset } from '../tryon/signing.js';
import { createArService } from './ar.service.js';

/**
 * Composition root for the AR try-on feature. Reuses the Phase 3 private-file storage factory and the HMAC
 * signing helper (with its own storage root and the distinct signature kind `arcapture`); it does not touch
 * the Phase 3 provider architecture.
 */
const a = env.ar;

export const signingKey = deriveSigningKey(env.jwtSecret);
export const storage = createTryOnStorage(a.dir, ['captures', 'overlays']);

/** Signed, expiring URL of a saved screenshot (the signature binds kind, id, customer and expiry). */
export const SIGN_KIND = 'arcapture';
const sign = (_kind, id, userId) => {
  const { exp, u, sig } = signAsset(signingKey, { kind: SIGN_KIND, id, userId, ttlSeconds: a.signedUrlTtlSeconds });
  return `/api/ar/assets/capture/${encodeURIComponent(id)}?exp=${exp}&u=${u}&sig=${sig}`;
};

export const arService = createArService({ pool, withTransaction, storage, sign, config: a });

/** Delete expired saved screenshots shortly after start and then periodically. The timer never keeps the process alive. */
export function startArMaintenance(intervalMs = 60 * 60 * 1000) {
  const run = () => arService.purgeExpired()
    .then((r) => { if (r.deleted) console.log(`[ar] cleanup: ${r.deleted} expired screenshot(s) deleted`); })
    .catch((err) => console.warn('[ar] cleanup failed:', err.message));
  setTimeout(run, 20_000).unref();
  setInterval(run, intervalMs).unref();
}
