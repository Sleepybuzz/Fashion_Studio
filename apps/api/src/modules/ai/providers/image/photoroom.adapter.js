import { PROVIDER_ERROR as E, ProviderError } from '../errors.js';
import { mapHttpStatus } from '../../utils/http.js';
import { detectImageMime } from '../../../tryon/image.inspect.js';

/**
 * PhotoRoom image-editing adapter ("Edit With AI").
 *
 * Per PhotoRoom's docs (https://docs.photoroom.com/image-editing-api-plus-plan/edit-with-ai):
 *   endpoint   POST https://image-api.photoroom.com/v2/edit        header  x-api-key: <key>
 *   body       multipart/form-data:
 *                imageFile              the input image
 *                removeBackground=false keep the original scene (we edit, we do not cut out)
 *                referenceBox=originalImage   keep the original framing / size
 *                editWithAI.mode=ai.auto      REQUIRED to turn the feature on
 *                editWithAI.prompt=...        the text instruction
 *                editWithAI.seed=...          optional, for similar results on the same image + prompt
 *   response   the edited image bytes (NOT json). Errors come back as a non-2xx status, usually with a JSON body.
 *   sandbox    prefix the key with "sandbox_" for free, watermarked test calls.
 *
 * The exact error-body shape is not documented in detail, so errors are classified from the HTTP status plus a
 * defensive look at the message text. Everything unknown becomes GENERATION_FAILED (never a raw error).
 */

export const ID = 'photoroom';
const MAX_RESULT_BYTES = 15 * 1024 * 1024;

/** @param {Record<string,string|undefined>} e process.env */
export function configFromEnv(e) {
  const secs = Number(e.PHOTOROOM_TIMEOUT_SECONDS);
  return {
    apiKey: (e.PHOTOROOM_API_KEY || '').trim(),
    baseUrl: (e.PHOTOROOM_API_BASE_URL || 'https://image-api.photoroom.com').trim().replace(/\/+$/, ''),
    timeoutMs: (Number.isFinite(secs) && secs >= 10 ? Math.min(secs, 300) : 120) * 1000,
  };
}

const textOf = (payload) => {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  const d = payload.detail ?? payload.message ?? payload.error;
  return [typeof d === 'string' ? d : d?.message, payload.type, payload.code].filter((x) => typeof x === 'string').join(' | ');
};

/** Map a PhotoRoom HTTP error to a normalized code. Exported for tests. */
export function mapPhotoroomError(status, payload) {
  const text = textOf(payload);
  if (status === 402 || /credit|quota|billing|payment|plan|limit reached|exceeded/i.test(text) && status !== 429) return E.QUOTA_EXCEEDED;
  if (/moderat|safety|nsfw|policy|flagged|prohibited|inappropriate/i.test(text)) return E.CONTENT_POLICY;
  if (status === 400 || status === 413 || status === 415 || status === 422) {
    if (/image|file|format|size|dimension|decode|too (large|small)/i.test(text)) return E.INVALID_PHOTO;
  }
  return mapHttpStatus(status);
}

/**
 * @param {{apiKey:string, baseUrl:string, timeoutMs:number}} cfg
 * @param {{fetchImpl?: typeof fetch, now?: () => number}} [deps]
 * @returns {import('./image-provider.contract.js').ImageProvider}
 */
export function createPhotoroomAdapter(cfg, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const configIssue = () => (cfg.apiKey ? null : 'PHOTOROOM_API_KEY not set in apps/api/.env');
  const isConfigured = () => configIssue() === null;
  const sandbox = () => cfg.apiKey.startsWith('sandbox_');

  return {
    id: ID,
    configIssue,
    isConfigured,
    describe: () => ({
      id: ID,
      label: 'PhotoRoom',
      operator: 'PhotoRoom (Photoroom, Inc.)',
      privacyUrl: 'https://www.photoroom.com/privacy-policy',
      model: 'edit-with-ai (ai.auto)',
      testMode: sandbox(),
      disclosure: [
        'The garment image you are editing and your edit instruction are sent to PhotoRoom, which applies the change with its AI image editor.',
        ...(sandbox() ? ['This server is in PhotoRoom sandbox mode: results carry a watermark and are for testing only.'] : []),
        'Check PhotoRoom\'s current API terms and privacy policy for how long inputs and outputs are retained.',
      ],
    }),

    /** One paid call. Never retried here, so a slow or failed call cannot create a duplicate generation. */
    async editImage({ image, prompt, seed }) {
      if (!isConfigured()) throw new ProviderError(E.NOT_CONFIGURED, { providerCode: 'NO_LOCAL_CONFIG' });
      const form = new FormData();
      form.append('imageFile', new Blob([image.buffer], { type: image.mimeType || 'image/png' }), 'input.png');
      form.append('removeBackground', 'false');
      form.append('referenceBox', 'originalImage');
      form.append('editWithAI.mode', 'ai.auto');
      form.append('editWithAI.prompt', prompt);
      if (Number.isInteger(seed)) form.append('editWithAI.seed', String(seed));

      const started = now();
      let res;
      try {
        res = await fetchImpl(`${cfg.baseUrl}/v2/edit`, {
          method: 'POST',
          headers: { 'x-api-key': cfg.apiKey }, // no Content-Type: fetch sets the multipart boundary itself
          body: form,
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });
      } catch (err) {
        const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        throw new ProviderError(timedOut ? E.TIMEOUT : E.UNAVAILABLE, { providerCode: timedOut ? 'LOCAL_TIMEOUT' : 'NETWORK_ERROR' });
      }

      if (!res.ok) {
        let payload = null;
        try {
          const raw = await res.text();
          try { payload = JSON.parse(raw); } catch { payload = raw.slice(0, 300); }
        } catch { /* unreadable body */ }
        throw new ProviderError(mapPhotoroomError(res.status, payload), {
          providerCode: `HTTP_${res.status}`,
          httpStatus: res.status,
          providerMessage: textOf(payload),
        });
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_RESULT_BYTES) throw new ProviderError(E.GENERATION_FAILED, { providerCode: 'RESULT_TOO_LARGE' });
      const mimeType = detectImageMime(buffer);
      if (!mimeType) throw new ProviderError(E.GENERATION_FAILED, { providerCode: 'RESULT_NOT_AN_IMAGE' });
      return { image: { buffer, mimeType }, model: 'photoroom-edit-with-ai', meta: { latencyMs: now() - started, sandbox: sandbox() } };
    },
  };
}
