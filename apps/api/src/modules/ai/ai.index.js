import { pool } from '../../config/db.js';
import { env } from '../../config/env.js';
import { arService } from '../ar/ar.index.js';
import { downloadImage } from '../tryon/download.js';
import { createDesign, deleteDesign, getOptions } from '../garments/garments.service.js';
import { createChatService } from './chat/chat.service.js';
import { providers } from './providers/index.js';
import { aiRepo, aiStorage, signAiAsset } from './ai.shared.js';
import { createProductSource } from './sessions/ai-source.js';
import { createCustomizationService } from './sessions/customization.service.js';

/**
 * Composition root for AI customization: the only place that connects the real database, file storage, product data and
 * the configured providers to the (dependency-injected) business logic.
 */
export { providers, aiRepo, aiStorage };

export const productSource = createProductSource({
  pool, uploadDir: env.uploadDir, downloadImage, getOptions, maxImageBytes: 15 * 1024 * 1024,
});

export const chatService = createChatService({ getChatProvider: () => providers.chat });

export const aiService = createCustomizationService({
  repo: aiRepo,
  storage: aiStorage,
  chat: chatService,
  providers,
  productSource,
  config: env.ai,
  sign: (which, id, userId) => signAiAsset(which, id, userId),
  createDesign,
  deleteDesign,
  arService,
});

/** Delete expired sessions shortly after start and then periodically. The timer never keeps the process alive. */
export function startAiMaintenance(intervalMs = 30 * 60 * 1000) {
  const run = () => aiService.purgeExpired()
    .then((r) => { if (r.deleted || r.failedStale) console.log(`[ai] cleanup: ${r.deleted} expired session(s) deleted, ${r.failedStale} stale generation(s) marked failed`); })
    .catch((err) => console.warn('[ai] cleanup failed:', err.message));
  setTimeout(run, 25_000).unref();
  setInterval(run, intervalMs).unref();
}
