import { PROVIDER_ERROR as E, ProviderError } from '../errors.js';
import { mapHttpStatus, requestJson } from '../../utils/http.js';
import { downloadImage } from '../../../tryon/download.js';
import { detectImageMime } from '../../../tryon/image.inspect.js';

/**
 * Cloudflare Workers AI image-editing adapter (FLUX.1 Kontext [pro]).
 *
 * Per Cloudflare's model page (https://developers.cloudflare.com/ai/models/black-forest-labs/flux-1-kontext-pro/):
 *   model id    black-forest-labs/flux-1-kontext-pro
 *   endpoint    POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run      Authorization: Bearer {API_TOKEN}
 *   body        { "model": "...", "input": { prompt, input_image (base64 or URL), aspect_ratio, seed, output_format } }
 *   response    { "state": "Completed", "result": { "image": "<URL>" } }   (the page's example returns a URL, not base64)
 *   price       listed as $0.04 per image on that page (a paid partner model: do not assume a free allocation)
 *
 * Details the page does NOT state (so they are handled defensively and are NOT verified against the live service):
 * the maximum input size, whether `result.image` can also be base64, and any asynchronous status endpoint.
 * This adapter accepts a URL or base64 in `result.image`, and reports an asynchronous reply as a clear failure
 * instead of guessing at an undocumented polling endpoint.
 */

export const ID = 'cloudflare';
export const DEFAULT_MODEL = 'black-forest-labs/flux-1-kontext-pro';
const MAX_RESULT_BYTES = 15 * 1024 * 1024;

/** Aspect ratios inside the documented 3:7 .. 7:3 range. The nearest one keeps the original framing. */
const RATIOS = ['3:7', '9:16', '2:3', '3:4', '4:5', '1:1', '5:4', '4:3', '3:2', '16:9', '7:3'];

/** @param {{width:number,height:number}|undefined} size */
export function nearestAspectRatio(size) {
  if (!size?.width || !size?.height) return '1:1';
  const target = Math.log(size.width / size.height);
  let best = RATIOS[0];
  let bestDist = Infinity;
  for (const r of RATIOS) {
    const [w, h] = r.split(':').map(Number);
    const d = Math.abs(Math.log(w / h) - target);
    if (d < bestDist) { best = r; bestDist = d; }
  }
  return best;
}

/** @param {Record<string,string|undefined>} e process.env */
export function configFromEnv(e) {
  const secs = Number(e.CLOUDFLARE_TIMEOUT_SECONDS);
  return {
    accountId: (e.CLOUDFLARE_ACCOUNT_ID || '').trim(),
    apiToken: (e.CLOUDFLARE_API_TOKEN || '').trim(),
    model: (e.CLOUDFLARE_IMAGE_MODEL || DEFAULT_MODEL).trim(),
    baseUrl: (e.CLOUDFLARE_API_BASE_URL || 'https://api.cloudflare.com/client/v4').trim().replace(/\/+$/, ''),
    timeoutMs: (Number.isFinite(secs) && secs >= 10 ? Math.min(secs, 300) : 120) * 1000,
  };
}

const errorText = (payload) => [
  ...(Array.isArray(payload?.errors) ? payload.errors.map((x) => `${x?.code ?? ''} ${x?.message ?? ''}`) : []),
  typeof payload?.error === 'string' ? payload.error : payload?.error?.message,
  payload?.message,
].filter(Boolean).join(' | ');

/** Map a Cloudflare / model error to a normalized code. Exported for tests. */
export function mapCloudflareError(status, payload) {
  const text = errorText(payload);
  if (/neuron|daily free allocation|quota|billing|payment|insufficient|credit/i.test(text)) return E.QUOTA_EXCEEDED;
  if (/moderat|safety|nsfw|policy|flagged|prohibited/i.test(text)) return E.CONTENT_POLICY;
  if (/image|input_image|decode|format|too large|dimension/i.test(text) && status >= 400 && status < 500 && status !== 429) return E.INVALID_PHOTO;
  return mapHttpStatus(status);
}

/**
 * @param {{accountId:string, apiToken:string, model:string, baseUrl:string, timeoutMs:number}} cfg
 * @param {{fetchImpl?: typeof fetch, downloadImpl?: typeof downloadImage, now?: () => number}} [deps]
 * @returns {import('./image-provider.contract.js').ImageProvider}
 */
export function createCloudflareAdapter(cfg, { fetchImpl = globalThis.fetch, downloadImpl = downloadImage, now = Date.now } = {}) {
  const configIssue = () => {
    const missing = [];
    if (!cfg.accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
    if (!cfg.apiToken) missing.push('CLOUDFLARE_API_TOKEN');
    return missing.length ? `${missing.join(' and ')} not set in apps/api/.env` : null;
  };
  const isConfigured = () => configIssue() === null;

  /** Turn `result.image` (URL, data URI or raw base64) into bytes. */
  async function readResultImage(value) {
    if (typeof value !== 'string' || !value) throw new ProviderError(E.GENERATION_FAILED, { providerCode: 'NO_RESULT_IMAGE' });
    let buffer;
    if (/^https:\/\//i.test(value)) {
      try {
        buffer = await downloadImpl(value, { maxBytes: MAX_RESULT_BYTES, fetchImpl });
      } catch {
        throw new ProviderError(E.UNAVAILABLE, { providerCode: 'RESULT_DOWNLOAD_FAILED' });
      }
    } else {
      buffer = Buffer.from(value.replace(/^data:[^,]*,/, ''), 'base64');
      if (buffer.length > MAX_RESULT_BYTES) throw new ProviderError(E.GENERATION_FAILED, { providerCode: 'RESULT_TOO_LARGE' });
    }
    const mimeType = detectImageMime(buffer);
    if (!mimeType) throw new ProviderError(E.GENERATION_FAILED, { providerCode: 'RESULT_NOT_AN_IMAGE' });
    return { buffer, mimeType };
  }

  return {
    id: ID,
    configIssue,
    isConfigured,
    describe: () => ({
      id: ID,
      label: 'Cloudflare Workers AI',
      operator: 'Cloudflare, Inc. (running Black Forest Labs FLUX.1 Kontext)',
      privacyUrl: 'https://www.cloudflare.com/privacypolicy/',
      model: cfg.model || null,
      disclosure: [
        'The garment image you are editing and your edit instruction are sent to Cloudflare Workers AI, which runs a third-party image model (Black Forest Labs FLUX.1 Kontext).',
        'Check Cloudflare\'s current Workers AI and partner-model terms for how long inputs and outputs are retained and whether they are used for training.',
      ],
    }),

    /** One paid call. Never retried here, so a slow or failed call cannot create a duplicate generation. */
    async editImage({ image, prompt, size, seed }) {
      if (!isConfigured()) throw new ProviderError(E.NOT_CONFIGURED, { providerCode: 'NO_LOCAL_CONFIG' });
      const input = {
        prompt,
        input_image: image.buffer.toString('base64'),
        aspect_ratio: nearestAspectRatio(size),
        output_format: 'png',
        ...(Number.isInteger(seed) ? { seed } : {}),
      };
      const started = now();
      const url = `${cfg.baseUrl}/accounts/${encodeURIComponent(cfg.accountId)}/ai/run`;
      const { ok, status, payload } = await requestJson(fetchImpl, url, {
        headers: { Authorization: `Bearer ${cfg.apiToken}` },
        json: { model: cfg.model, input },
        timeoutMs: cfg.timeoutMs,
      });
      if (!ok || payload?.success === false) {
        throw new ProviderError(mapCloudflareError(status, payload), {
          providerCode: payload?.errors?.[0]?.code ? `CF_${payload.errors[0].code}` : `HTTP_${status}`,
          httpStatus: status,
          providerMessage: errorText(payload),
        });
      }
      const state = payload?.state;
      if (state && String(state).toLowerCase() !== 'completed') {
        // Cloudflare's page documents no status endpoint, so we cannot poll. Fail honestly instead of guessing.
        throw new ProviderError(/fail|error/i.test(String(state)) ? E.GENERATION_FAILED : E.UNAVAILABLE, { providerCode: `STATE_${String(state).toUpperCase()}` });
      }
      const out = await readResultImage(payload?.result?.image ?? payload?.result);
      return { image: out, model: cfg.model, meta: { latencyMs: now() - started } };
    },
  };
}
