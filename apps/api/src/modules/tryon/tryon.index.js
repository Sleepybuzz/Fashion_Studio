import { pool, withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { CONSENT_TEMPLATE_VERSION } from './tryon.constants.js';
import { createProvider } from './providers/index.js';
import { createTryOnRepo } from './tryon.repo.js';
import { createTryOnStorage } from './tryon.storage.js';
import { createTryOnCatalog } from './tryon.catalog.js';
import { createTryOnService } from './tryon.service.js';
import { createTryOnMaintenance } from './tryon.maintenance.js';
import { deriveSigningKey, signedPath } from './signing.js';
import { downloadImage } from './download.js';

/**
 * Composition root for the virtual try-on feature: the only place that connects the real database,
 * file storage and the configured provider to the (dependency-injected) business logic.
 */
const t = env.tryon;

export const signingKey = deriveSigningKey(env.jwtSecret);
export const storage = createTryOnStorage(t.dir);
export const provider = createProvider(t);
export const repo = createTryOnRepo({ pool, withTransaction });

const sign = (kind, id, userId) => signedPath(signingKey, '/api', { kind, id, userId, ttlSeconds: t.signedUrlTtlSeconds });
export const catalog = createTryOnCatalog({ pool, withTransaction, storage, sign, maxGarmentBytes: t.maxGarmentBytes });

export const serviceConfig = {
  apiPrefix: '/api',
  consentTemplateVersion: CONSENT_TEMPLATE_VERSION,
  signingKey,
  limits: {
    maxPhotoBytes: t.maxPhotoBytes,
    userDailyLimit: t.userDailyLimit,
    storeDailyCap: t.storeDailyCap,
    processingTimeoutMs: t.timeoutMs,
    pollMinIntervalMs: 1500,
    signedUrlTtlSeconds: t.signedUrlTtlSeconds,
  },
  retention: { unsavedDays: t.unsavedRetentionDays, savedDays: t.savedRetentionDays },
};

export const tryOnService = createTryOnService({ repo, catalog, provider, storage, config: serviceConfig, downloadImage });
export const maintenance = createTryOnMaintenance({ repo, storage, config: serviceConfig });

/** Print the provider status at startup. Never prints keys. The store keeps running when try-on is not configured. */
export function reportTryOnConfig(log = console) {
  const issue = provider.configIssue();
  if (issue) {
    log.warn(`[tryon] Virtual try-on is DISABLED: ${issue}. Customers will see it as unavailable (no simulated results).`);
    return;
  }
  const d = provider.describe();
  log.log(`[tryon] provider "${d.id}" is configured.`);
  if (d.testMode) {
    log.warn(`[tryon] ${d.label} TEST MODE is ON: results are not real AI output. Do not use in production.`);
    if (env.isProd) log.error('[tryon] WARNING: test mode is enabled while NODE_ENV=production.');
  }
}

/** Run retention cleanup shortly after start and then periodically. The timer never keeps the process alive. */
export function startTryOnMaintenance(intervalMs = 30 * 60 * 1000) {
  const run = () => maintenance.run()
    .then((r) => { if (r.deleted || r.failedStale) console.log(`[tryon] cleanup: ${r.deleted} expired deleted, ${r.failedStale} stale marked failed`); })
    .catch((err) => console.warn('[tryon] cleanup failed:', err.message));
  setTimeout(run, 15_000).unref();
  setInterval(run, intervalMs).unref();
}
