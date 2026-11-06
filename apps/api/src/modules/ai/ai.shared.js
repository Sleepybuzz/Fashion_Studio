import { pool, withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { createTryOnStorage } from '../tryon/tryon.storage.js';
import { deriveSigningKey, signAsset } from '../tryon/signing.js';
import { createAiRepo } from './sessions/ai.repo.js';

/**
 * Leaf module shared by the AI composition root (ai.index.js) and the Phase 3 try-on composition root
 * (tryon.index.js, which needs to read customized garment images). It imports no feature module, so there is no cycle.
 */
export const aiStorage = createTryOnStorage(env.ai.dir, ['originals', 'versions']);
export const aiRepo = createAiRepo({ pool, withTransaction });
export const aiSigningKey = deriveSigningKey(env.jwtSecret);

/** Signed-URL kinds. They differ from every other feature's kinds, so a signature for one file type never opens another. */
export const SIGN_KINDS = Object.freeze({ original: 'ai-original', version: 'ai-version' });

/**
 * Short-lived signed URL (an <img> cannot send a Bearer token). `which` is 'original' (id = session public id) or
 * 'version' (id = version public id).
 */
export function signAiAsset(which, id, userId, ttlSeconds = env.ai.signedUrlTtlSeconds, nowMs = Date.now()) {
  const { exp, u, sig } = signAsset(aiSigningKey, { kind: SIGN_KINDS[which], id, userId, ttlSeconds, nowMs });
  return `/api/ai/assets/${which}/${encodeURIComponent(id)}?exp=${exp}&u=${u}&sig=${sig}`;
}
