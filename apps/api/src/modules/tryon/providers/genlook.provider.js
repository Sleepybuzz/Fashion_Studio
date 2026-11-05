import { PROVIDER_ERROR as E, ProviderError } from './provider.contract.js';

/**
 * Genlook adapter (https://genlook.app/developers, docs: https://docs.genlook.app/docs/tryon-api/introduction.md).
 *
 * Endpoints used (verified against the official docs, Nov 2026):
 *   POST   {base}/images/upload          multipart: file, crop, externalUserId, keepForDays   -> { imageId }
 *   POST   {base}/try-on                 JSON, or multipart with a `data` JSON field + files  -> { generationId }
 *   GET    {base}/generations/:id        -> { status: PENDING|PROCESSING|COMPLETED|FAILED, resultImageUrl, errorCode }
 *   DELETE {base}/customers/:externalUserId   (GDPR erasure of everything sent for that user)  -> 204
 *   GET    {base}/account/credits        -> { creditBalance }
 * Auth: `x-api-key` header. The key only ever lives in this object, in server memory.
 *
 * Genlook has NO cancel endpoint and NO per-image delete endpoint; uploaded photos expire by themselves
 * (`keepForDays`: 1, 3 or 7) and `DELETE /customers/:id` erases everything for one user.
 */

/** Genlook error code -> normalized code. Anything unknown falls back by HTTP status. */
const CODE_MAP = {
  MISSING_API_KEY: E.NOT_CONFIGURED,
  INVALID_API_KEY: E.NOT_CONFIGURED,
  FORBIDDEN: E.NOT_CONFIGURED,
  INSUFFICIENT_CREDITS: E.INSUFFICIENT_CREDITS,
  QUOTA_EXCEEDED: E.QUOTA_EXCEEDED,
  RATE_LIMITED: E.RATE_LIMITED,
  UNSUPPORTED_IMAGE_TYPE: E.INVALID_PHOTO,
  INVALID_IMAGE: E.INVALID_PHOTO,
  FILE_TOO_LARGE: E.INVALID_PHOTO,
  CUSTOMER_IMAGE_FETCH_FAILED: E.INVALID_PHOTO,
  PRODUCT_IMAGES_REQUIRED: E.INVALID_GARMENT,
  PRODUCT_IMAGE_FETCH_FAILED: E.INVALID_GARMENT,
  INVALID_IMAGE_INPUT: E.INVALID_GARMENT,
  MULTIPART_FILE_NOT_FOUND: E.INVALID_GARMENT,
  MISSING_REQUIRED_CLASSIFICATION: E.INVALID_GARMENT,
  MULTI_PRODUCT_NOT_SUPPORTED: E.UNSUPPORTED_PRODUCT,
  CONTENT_POLICY_VIOLATION: E.CONTENT_POLICY,
  GENERATION_TIMEOUT: E.TIMEOUT,
  GENERATION_FAILED: E.GENERATION_FAILED,
  INTERNAL_ERROR: E.UNAVAILABLE,
};

/** @param {string|undefined} code @param {number|undefined} status */
export function mapGenlookError(code, status) {
  if (code && CODE_MAP[code]) return CODE_MAP[code];
  if (status === 401 || status === 403) return E.NOT_CONFIGURED;
  if (status === 402) return E.QUOTA_EXCEEDED;
  if (status === 429) return E.RATE_LIMITED;
  if (status >= 500) return E.UNAVAILABLE;
  return E.GENERATION_FAILED;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const blobOf = (img) => new Blob([img.buffer], { type: img.mimeType });

/**
 * @param {{apiKey:string, baseUrl:string, keepForDays:1|3|7, testMode:boolean, cropPhoto:boolean, requestTimeoutMs?:number}} cfg
 * @param {{fetchImpl?: typeof fetch}} [deps] inject a fake fetch in tests
 * @returns {import('./provider.contract.js').TryOnProvider}
 */
export function createGenlookProvider(cfg, { fetchImpl = globalThis.fetch } = {}) {
  const base = String(cfg.baseUrl).replace(/\/+$/, '');
  const timeoutMs = cfg.requestTimeoutMs || 30_000;

  const configIssue = () => (cfg.apiKey ? null : 'GENLOOK_API_KEY is not set in apps/api/.env');
  const isConfigured = () => configIssue() === null;
  const assertConfigured = () => { if (!isConfigured()) throw new ProviderError(E.NOT_CONFIGURED, { providerCode: 'NO_LOCAL_API_KEY' }); };

  /**
   * One HTTP call. `retries` is only ever > 0 for calls that cannot cost money (upload, status, delete).
   * Network failures and 5xx are retried; 4xx never are.
   */
  async function call(method, path, { json, form, retries = 0 } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await callOnce(method, path, { json, form });
      } catch (err) {
        const transient = err instanceof ProviderError && (err.code === E.UNAVAILABLE || err.code === E.TIMEOUT);
        if (!transient || attempt >= retries) throw err;
        await sleep(300 * (attempt + 1));
      }
    }
  }

  async function callOnce(method, path, { json, form }) {
    const headers = { 'x-api-key': cfg.apiKey, Accept: 'application/json' };
    let body;
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    else if (form) body = form; // fetch sets the multipart boundary itself

    let res;
    try {
      res = await fetchImpl(`${base}${path}`, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new ProviderError(timedOut ? E.TIMEOUT : E.UNAVAILABLE, { providerCode: timedOut ? 'LOCAL_TIMEOUT' : 'NETWORK_ERROR' });
    }
    if (res.status === 204) return null;
    let payload = null;
    try { payload = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok) {
      throw new ProviderError(mapGenlookError(payload?.code, res.status), {
        providerCode: payload?.code || `HTTP_${res.status}`,
        httpStatus: res.status,
        providerMessage: payload?.message,
      });
    }
    return payload;
  }

  async function uploadPhoto(photo, externalUserId) {
    const form = new FormData();
    form.append('file', blobOf(photo), photo.filename);
    // Keeping the original framing makes the before/after comparison line up.
    form.append('crop', cfg.cropPhoto ? 'true' : 'false');
    form.append('externalUserId', externalUserId);
    form.append('keepForDays', String(cfg.keepForDays));
    const out = await call('POST', '/images/upload', { form, retries: 1 });
    if (!out?.imageId) throw new ProviderError(E.GENERATION_FAILED, { providerCode: 'NO_IMAGE_ID' });
    return out.imageId;
  }

  async function createGeneration(imageId, garment, externalUserId) {
    const common = {
      person: { image: { source: { id: imageId } } },
      externalUserId,
      ...(cfg.testMode ? { mock: true } : {}), // documented free test flag: returns the person photo unchanged
    };
    let out;
    try {
      // 1) Reference an already-analysed product (faster, no garment upload). Creating nothing yet if it is unknown.
      out = await call('POST', '/try-on', { json: { products: [{ externalId: garment.externalId }], ...common } });
    } catch (err) {
      if (!(err instanceof ProviderError) || err.providerCode !== 'PRODUCT_NOT_FOUND') throw err;
      // 2) First use (or expired): send the product inline, garment photos as multipart bytes (never public URLs).
      const form = new FormData();
      const images = garment.images.map((img, i) => {
        form.append(`garment${i}`, blobOf(img), img.filename);
        return { source: { fileKey: `garment${i}` } };
      });
      form.append('data', JSON.stringify({
        products: [{ externalId: garment.externalId, title: garment.title, description: garment.description, images }],
        ...common,
      }));
      out = await call('POST', '/try-on', { form });
    }
    if (!out?.generationId) throw new ProviderError(E.GENERATION_FAILED, { providerCode: 'NO_GENERATION_ID' });
    return out.generationId;
  }

  return {
    id: 'genlook',
    configIssue,
    isConfigured,

    describe: () => ({
      id: 'genlook',
      label: 'Genlook',
      operator: 'Genlook (Parakeet Labs SASU, France)',
      privacyUrl: 'https://genlook.app/privacy',
      retentionDays: cfg.keepForDays,
      testMode: !!cfg.testMode,
      disclosure: [
        'Genlook states that photos and results are deleted automatically after the retention period, that they are not used to train AI models, and that no facial recognition or biometric identifiers are created.',
        'Genlook may use sub-processors, including AI infrastructure outside the EU/EEA.',
      ],
    }),

    async submitTryOn({ externalUserId, photo, garment }) {
      assertConfigured();
      const imageId = await uploadPhoto(photo, externalUserId);
      const jobId = await createGeneration(imageId, garment, externalUserId);
      return { jobId };
    },

    async getStatus(jobId) {
      assertConfigured();
      const out = await call('GET', `/generations/${encodeURIComponent(jobId)}`, { retries: 2 });
      switch (out?.status) {
        case 'COMPLETED':
          if (!out.resultImageUrl) return { state: 'failed', errorCode: E.GENERATION_FAILED, providerErrorCode: 'NO_RESULT_URL' };
          return { state: 'completed', resultUrl: out.resultImageUrl };
        case 'FAILED':
          return { state: 'failed', errorCode: mapGenlookError(out.errorCode, 200), providerErrorCode: out.errorCode || 'UNKNOWN' };
        case 'PROCESSING':
          return { state: 'processing' };
        default: // PENDING or an unknown future status: keep waiting; the local timeout still applies
          return { state: 'pending' };
      }
    },

    async deleteUserData(externalUserId) {
      assertConfigured();
      await call('DELETE', `/customers/${encodeURIComponent(externalUserId)}`, { retries: 1 });
    },

    async getCredits() {
      assertConfigured();
      const out = await call('GET', '/account/credits', { retries: 1 });
      return typeof out?.creditBalance === 'number' ? { balance: out.creditBalance } : null;
    },
  };
}
