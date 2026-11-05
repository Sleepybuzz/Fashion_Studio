import crypto from 'node:crypto';
import { AppError, badRequest, conflict, notFound } from '../../utils/AppError.js';
import { ACTIVE_STATUSES, FAILED_RETENTION_HOURS, IMAGE_LIMITS, MAX_ATTEMPTS, MAX_RESULT_BYTES, TRYON_STATUS } from './tryon.constants.js';
import { ImageValidationError, validateImage } from './image.inspect.js';
import { signedPath } from './signing.js';
import { describeTryOnError } from './tryon.errors.js';
import { PROVIDER_ERROR as E, ProviderError } from './providers/provider.contract.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Opaque id sent to the provider (no email/name) so a customer's data can be erased there. */
export const externalUserIdFor = (userId) => `afs-u${userId}`;

export const ELIGIBILITY_MESSAGES = Object.freeze({
  not_found: 'This product was not found.',
  not_active: 'This product is not currently available.',
  disabled: 'Virtual try-on is not available for this product.',
  no_images: 'Virtual try-on is not available for this product yet.',
});

/**
 * @param {{product:{status:string}, config:{enabled:boolean}|null, images:any[]}|null} data
 * @returns {{eligible:boolean, reason:null|keyof typeof ELIGIBILITY_MESSAGES}}
 */
export function evaluateEligibility(data) {
  if (!data) return { eligible: false, reason: 'not_found' };
  if (data.product.status !== 'active') return { eligible: false, reason: 'not_active' };
  if (!data.config?.enabled) return { eligible: false, reason: 'disabled' };
  if (!data.images.length) return { eligible: false, reason: 'no_images' };
  return { eligible: true, reason: null };
}

/**
 * Provider-neutral garment description. The id embeds a fingerprint of the text and photos, so when the store
 * owner changes the photos or description a *new* provider product is created instead of reusing a stale one.
 */
export function buildGarmentSpec(product, config, imageRows) {
  const title = String(product.name).slice(0, 200);
  const description = String(config?.aiDescription || product.description || '').replace(/\s+/g, ' ').trim().slice(0, 500) || title;
  const fingerprint = crypto.createHash('sha256').update([title, description, ...imageRows.map((r) => r.sha256)].join('|')).digest('hex').slice(0, 12);
  return { externalId: `afs-p${product.id}-${fingerprint}`, title, description };
}

/** Consent text shown to the customer. Built from the active provider so a provider switch changes the wording. */
export function buildConsent(providerInfo, { templateVersion, retention }) {
  const days = (n) => `${n} day${n === 1 ? '' : 's'}`;
  const points = [
    `Your photo and the product's garment photos will be sent to ${providerInfo.operator}, an external AI service, to generate your try-on image.`,
    `${providerInfo.label} keeps uploaded photos and results for up to ${days(providerInfo.retentionDays)} and then deletes them automatically.`,
    ...providerInfo.disclosure,
    `We store your photo and the result privately on our servers. Only you can view them. Results you do not save are deleted after ${days(retention.unsavedDays)}; saved results after ${days(retention.savedDays)}. You can delete them at any time.`,
    'The result is an AI-generated image. It is an approximation and does not guarantee fit, size, colour or fabric drape.',
    'Only upload a photo of yourself, or of someone who has agreed. Do not upload photos of children.',
  ];
  if (providerInfo.testMode) points.unshift('TEST MODE: the store is using the provider\'s test mode. Results are NOT real AI output.');
  return {
    version: `${templateVersion}-${providerInfo.id}`,
    checkboxLabel: `I agree that my photo may be sent to ${providerInfo.operator} to create this try-on.`,
    points,
  };
}

const errorOf = (err) => (err instanceof ProviderError ? err : new ProviderError(E.INTERNAL));

/**
 * Virtual try-on orchestration. All I/O is injected so the logic can be tested without MySQL or a provider.
 *
 * Flow: createSession (validate, enforce limits, store photo privately, insert row) -> background submit()
 * (send to provider, once) -> clients poll getSession(), which refreshes the provider status on demand and,
 * on completion, downloads and stores the result privately. There is no background worker: a restart cannot
 * lose a job because status is recovered from the provider id stored in the database.
 *
 * @param {object} deps
 */
export function createTryOnService({
  repo, catalog, provider, storage, config, downloadImage,
  schedule = (fn) => setImmediate(fn), logger = console, now = Date.now,
}) {
  const inflight = new Map();
  const dedupe = (key, fn) => {
    if (inflight.has(key)) return inflight.get(key);
    const p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
  const at = (ms = now()) => new Date(ms);
  const consentInfo = () => buildConsent(provider.describe(), { templateVersion: config.consentTemplateVersion, retention: config.retention });
  const sign = (kind, id, userId) => signedPath(config.signingKey, config.apiPrefix, { kind, id, userId, ttlSeconds: config.limits.signedUrlTtlSeconds, nowMs: now() });

  // ------------------------------------------------------------------ views

  function toView(row) {
    const failed = row.status === TRYON_STATUS.FAILED;
    const err = failed ? describeTryOnError(row.error_code) : null;
    return {
      id: row.public_id,
      status: row.status,
      product: { id: row.product_id, name: row.product_name, slug: row.product_slug },
      provider: row.provider,
      isTest: !!row.is_test,
      attempts: row.attempts,
      photoUrl: sign('photo', row.public_id, row.user_id),
      resultUrl: row.status === TRYON_STATUS.COMPLETED && row.result_key ? sign('result', row.public_id, row.user_id) : null,
      error: err ? { code: err.code, message: err.message, canRetry: err.retryable && row.attempts < MAX_ATTEMPTS } : null,
      saved: !!row.saved_at,
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    };
  }

  // ------------------------------------------------------------------ failure helpers

  async function failRow(row, code, providerCode) {
    await repo.markFailed({
      id: row.id, errorCode: code, providerErrorCode: providerCode || null,
      expiresAt: at(now() + FAILED_RETENTION_HOURS * 60 * 60 * 1000), now: at(),
    });
    logger.warn?.(`[tryon] session ${row.public_id} failed: ${code}${providerCode ? ` (${providerCode})` : ''}`);
  }

  // ------------------------------------------------------------------ config / eligibility

  async function getPublicConfig(user) {
    await repo.failStale({ cutoff: at(now() - config.limits.processingTimeoutMs), now: at(), userId: user.id });
    const d = provider.describe();
    const active = await repo.findActiveForUser(user.id);
    return {
      available: provider.isConfigured(),
      provider: { id: d.id, label: d.label, operator: d.operator, privacyUrl: d.privacyUrl, retentionDays: d.retentionDays, testMode: d.testMode },
      consent: consentInfo(),
      limits: {
        maxPhotoMb: Math.round(config.limits.maxPhotoBytes / 1024 / 1024),
        minPhotoSide: IMAGE_LIMITS.photo.minSide,
        acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
        dailyLimit: config.limits.userDailyLimit,
        maxAttempts: MAX_ATTEMPTS,
      },
      retention: { unsavedDays: config.retention.unsavedDays, savedDays: config.retention.savedDays },
      activeSessionId: active?.public_id ?? null,
    };
  }

  async function getEligibility(slug) {
    const data = await catalog.getBySlug(slug);
    const { eligible, reason } = evaluateEligibility(data);
    return {
      eligible,
      reason,
      message: reason ? ELIGIBILITY_MESSAGES[reason] : null,
      product: data ? { id: data.product.id, name: data.product.name, slug: data.product.slug, primaryImage: data.product.primaryImage ?? null } : null,
    };
  }

  // ------------------------------------------------------------------ create / submit

  async function enforceLimits(userId) {
    const dayAgo = at(now() - DAY_MS);
    if (config.limits.userDailyLimit > 0) {
      const mine = await repo.countCreatedSince({ since: dayAgo, userId });
      if (mine >= config.limits.userDailyLimit) {
        throw new AppError(429, `You have reached the limit of ${config.limits.userDailyLimit} virtual try-ons per day. Please try again tomorrow.`);
      }
    }
    if (config.limits.storeDailyCap > 0) {
      const all = await repo.countCreatedSince({ since: dayAgo });
      if (all >= config.limits.storeDailyCap) {
        throw new AppError(429, 'Virtual try-on is very busy today. Please try again tomorrow.');
      }
    }
  }

  const assertProviderReady = () => {
    if (!provider.isConfigured()) throw new AppError(503, 'Virtual try-on is not available right now. Please try again later.');
  };

  /**
   * @param {{user:{id:number}, productId:number, consent:boolean, consentVersion:string, photo:{buffer:Buffer}}} input
   */
  async function createSession({ user, productId, consent, consentVersion, photo }) {
    if (consent !== true) throw badRequest('Please agree to the photo processing terms to continue.', { consent: 'Consent is required' });
    assertProviderReady();
    const current = consentInfo();
    if (consentVersion !== current.version) {
      throw badRequest('The consent terms have changed. Please reload the page and review them again.', { consent: 'Outdated consent version' });
    }

    const data = await catalog.getById(productId);
    if (!data) throw notFound('Product not found');
    const elig = evaluateEligibility(data);
    if (!elig.eligible) throw new AppError(422, ELIGIBILITY_MESSAGES[elig.reason]);

    let info;
    try {
      info = validateImage(photo?.buffer, { ...IMAGE_LIMITS.photo, maxBytes: config.limits.maxPhotoBytes });
    } catch (err) {
      if (err instanceof ImageValidationError) throw badRequest(err.message, { photo: err.message });
      throw err;
    }

    await repo.failStale({ cutoff: at(now() - config.limits.processingTimeoutMs), now: at(), userId: user.id });
    await enforceLimits(user.id);

    const key = await storage.save('photos', photo.buffer, info.ext);
    const nowDate = at();
    let inserted;
    try {
      inserted = await repo.insertExclusive({
        publicId: crypto.randomUUID(),
        userId: user.id,
        productId: data.product.id,
        productName: data.product.name,
        productSlug: data.product.slug,
        provider: provider.id,
        photoKey: key, photoMime: info.mime, photoSize: info.size, photoWidth: info.width, photoHeight: info.height,
        consentVersion: current.version, consentProvider: provider.id, consentedAt: nowDate,
        now: nowDate,
      });
    } catch (err) {
      await storage.remove('photos', key);
      throw err;
    }
    if (inserted.conflict) {
      await storage.remove('photos', key);
      throw conflict('You already have a try-on in progress. Please wait for it to finish.');
    }
    schedule(() => submit(inserted.id).catch((err) => logger.error?.('[tryon] unexpected submit error', err?.message)));
    return toView(await repo.getById(inserted.id));
  }

  /** Send a validated session to the provider exactly once. Never retries the paid call. */
  async function submit(id) {
    const row = await repo.getById(id);
    if (!row || row.status !== TRYON_STATUS.VALIDATING) return;
    try {
      const data = row.product_id ? await catalog.getById(row.product_id) : null;
      const elig = evaluateEligibility(data);
      if (!elig.eligible) return await failRow(row, E.INVALID_GARMENT, 'NOT_ELIGIBLE_AT_SUBMIT');

      const spec = buildGarmentSpec(data.product, data.config, data.images);
      const images = await Promise.all(data.images.map(async (img) => ({
        buffer: await storage.read('garments', img.storageKey), mimeType: img.mimeType, filename: img.storageKey,
      })));
      const photo = { buffer: await storage.read('photos', row.photo_key), mimeType: row.photo_mime, filename: row.photo_key };

      const { jobId } = await provider.submitTryOn({
        externalUserId: externalUserIdFor(row.user_id),
        photo,
        garment: { ...spec, images },
      });
      await repo.markProcessing({ id, jobId, isTest: provider.describe().testMode, now: at() });
    } catch (err) {
      const e = errorOf(err);
      await failRow(row, e.code, e.providerCode || (err instanceof ProviderError ? null : 'LOCAL_ERROR'));
      if (!(err instanceof ProviderError)) logger.error?.('[tryon] local error during submit:', err?.message);
    }
  }

  // ------------------------------------------------------------------ polling / completion

  async function finalize(row, resultUrl) {
    let buffer;
    try {
      buffer = await downloadImage(resultUrl, { maxBytes: MAX_RESULT_BYTES });
    } catch (err) {
      logger.warn?.(`[tryon] result download failed for ${row.public_id}: ${err?.message}`);
      return row; // the provider URL is temporary but re-fetchable; try again on the next poll
    }
    let info;
    try {
      info = validateImage(buffer, { minSide: 16, maxSide: 20_000, maxPixels: 120_000_000, maxBytes: MAX_RESULT_BYTES });
    } catch {
      await failRow(row, E.GENERATION_FAILED, 'BAD_RESULT_IMAGE');
      return repo.getById(row.id);
    }
    const key = await storage.save('results', buffer, info.ext);
    const ok = await repo.markCompleted({
      id: row.id, resultKey: key, resultMime: info.mime, resultSize: info.size,
      expiresAt: at(now() + config.retention.unsavedDays * DAY_MS), now: at(),
    });
    if (!ok) await storage.remove('results', key); // another request finished it first
    return repo.getById(row.id);
  }

  async function refresh(row) {
    if (!ACTIVE_STATUSES.includes(row.status)) return row;
    const startedAt = new Date(row.submitted_at || row.created_at).getTime();
    if (now() - startedAt > config.limits.processingTimeoutMs) {
      await failRow(row, E.TIMEOUT, 'LOCAL_TIMEOUT');
      return repo.getById(row.id);
    }
    if (row.status !== TRYON_STATUS.PROCESSING || !row.provider_job_id) return row;
    if (row.last_polled_at && now() - new Date(row.last_polled_at).getTime() < config.limits.pollMinIntervalMs) return row;

    return dedupe(row.id, async () => {
      await repo.touchPolled(row.id, at());
      let st;
      try {
        st = await provider.getStatus(row.provider_job_id);
      } catch (err) {
        logger.warn?.(`[tryon] status check failed for ${row.public_id}: ${errorOf(err).code}`);
        return row; // transient: keep waiting; the local timeout still applies
      }
      if (st.state === 'completed') return finalize(row, st.resultUrl);
      if (st.state === 'failed') {
        await failRow(row, st.errorCode || E.GENERATION_FAILED, st.providerErrorCode);
        return repo.getById(row.id);
      }
      return row;
    });
  }

  // ------------------------------------------------------------------ customer operations

  async function ownedOrThrow(publicId, userId) {
    const row = await repo.getOwned(publicId, userId);
    if (!row) throw notFound('Try-on not found');
    return row;
  }

  async function getSession(user, publicId) {
    const row = await ownedOrThrow(publicId, user.id);
    return toView(await refresh(row));
  }

  async function listSessions(user, { limit, offset }) {
    await repo.failStale({ cutoff: at(now() - config.limits.processingTimeoutMs), now: at(), userId: user.id });
    const { rows, total } = await repo.listForUser(user.id, { limit, offset });
    return { items: rows.map(toView), total };
  }

  async function retrySession(user, publicId) {
    const row = await ownedOrThrow(publicId, user.id);
    if (row.status !== TRYON_STATUS.FAILED) throw conflict('Only a failed try-on can be retried.');
    const err = describeTryOnError(row.error_code);
    if (!err.retryable) throw conflict('This try-on cannot be retried. Please start a new one.');
    if (row.attempts >= MAX_ATTEMPTS) throw conflict('This try-on has reached the maximum number of attempts. Please start a new one.');
    assertProviderReady();
    await enforceLimits(user.id);
    const out = await repo.resetForRetryExclusive({ id: row.id, userId: user.id, now: at() });
    if (out.conflict) throw conflict('You already have a try-on in progress. Please wait for it to finish.');
    schedule(() => submit(row.id).catch((e) => logger.error?.('[tryon] unexpected submit error', e?.message)));
    return toView(await repo.getById(row.id));
  }

  async function removeFiles(row) {
    await storage.remove('photos', row.photo_key);
    if (row.result_key) await storage.remove('results', row.result_key);
  }

  async function deleteSession(user, publicId) {
    const row = await ownedOrThrow(publicId, user.id);
    if (ACTIVE_STATUSES.includes(row.status)) throw conflict('This try-on is still being processed. Please wait until it finishes.');
    await repo.deleteById(row.id);
    await removeFiles(row);
  }

  /** Delete every try-on of the customer and ask the provider to erase everything it holds for them. */
  async function deleteAll(user) {
    const rows = await repo.listAllForUser(user.id);
    if (rows.some((r) => ACTIVE_STATUSES.includes(r.status))) throw conflict('A try-on is still being processed. Please wait until it finishes.');
    for (const row of rows) {
      await repo.deleteById(row.id);
      await removeFiles(row);
    }
    let providerErased = false;
    if (provider.isConfigured()) {
      try {
        await provider.deleteUserData(externalUserIdFor(user.id));
        providerErased = true;
      } catch (err) {
        logger.warn?.(`[tryon] provider erase failed for user ${user.id}: ${errorOf(err).code}`);
      }
    }
    return { deleted: rows.length, providerErased };
  }

  async function setSaved(user, publicId, saved) {
    const row = await ownedOrThrow(publicId, user.id);
    if (row.status !== TRYON_STATUS.COMPLETED) throw conflict('Only a completed try-on can be saved.');
    const days = saved ? config.retention.savedDays : config.retention.unsavedDays;
    await repo.setSaved({ id: row.id, savedAt: saved ? at() : null, expiresAt: at(now() + days * DAY_MS), now: at() });
    return toView(await repo.getById(row.id));
  }

  // ------------------------------------------------------------------ files (signed-URL routes)

  /** Resolve a stored file for a signed request. The route has already verified the signature. */
  async function resolveSessionFile(kind, publicId, userId) {
    const row = await repo.getOwned(publicId, userId);
    if (!row) throw notFound('Image not found');
    if (kind === 'photo') return { kind: 'photos', key: row.photo_key, mime: row.photo_mime };
    if (kind === 'result' && row.result_key) return { kind: 'results', key: row.result_key, mime: row.result_mime };
    throw notFound('Image not found');
  }

  // ------------------------------------------------------------------ admin

  async function adminOverview() {
    const d = provider.describe();
    const since = at(now() - 30 * DAY_MS);
    return {
      provider: { id: d.id, label: d.label, configured: provider.isConfigured(), configIssue: provider.configIssue(), testMode: d.testMode, supportsCredits: typeof provider.getCredits === 'function' },
      limits: { userDailyLimit: config.limits.userDailyLimit, storeDailyCap: config.limits.storeDailyCap },
      last30Days: await repo.overview({ since }),
    };
  }

  async function adminCredits() {
    if (typeof provider.getCredits !== 'function') throw new AppError(501, 'This provider does not report credits.');
    assertProviderReady();
    try {
      return (await provider.getCredits()) || { balance: null };
    } catch (err) {
      logger.warn?.(`[tryon] credit check failed: ${errorOf(err).code}`);
      throw new AppError(502, 'Could not read the credit balance from the provider. Check the API key and try again.');
    }
  }

  return {
    getPublicConfig, getEligibility, createSession, submit, getSession, listSessions, retrySession,
    deleteSession, deleteAll, setSaved, resolveSessionFile, adminOverview, adminCredits, refresh, toView,
  };
}
