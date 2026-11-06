import { PROVIDER_ERROR as E, ProviderError } from '../errors.js';
import { mapHttpStatus, requestJson, withSafeRetry } from '../../utils/http.js';

/**
 * Google Gemini chat adapter (Developer API, REST `generateContent`).
 *
 *   POST {base}/models/{model}:generateContent        header: x-goog-api-key
 *   body: { systemInstruction:{parts:[{text}]}, contents:[{role:'user'|'model', parts:[{text}]}], generationConfig:{...} }
 *   reply text: candidates[0].content.parts[].text
 *
 * Source: https://ai.google.dev/api/generate-content (endpoint, body and response fields). JSON answers use
 * `generationConfig.responseMimeType = "application/json"`; the application describes the shape in the prompt and
 * validates the result itself, so this adapter does not depend on a particular schema dialect.
 * The model identifier is NOT hardcoded: set GEMINI_CHAT_MODEL (model names change; see the README).
 */

export const ID = 'gemini';

/** @param {Record<string,string|undefined>} e process.env */
export function configFromEnv(e) {
  const secs = Number(e.GEMINI_TIMEOUT_SECONDS);
  return {
    apiKey: (e.GEMINI_API_KEY || '').trim(),
    model: (e.GEMINI_CHAT_MODEL || '').trim(),
    baseUrl: (e.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').trim().replace(/\/+$/, ''),
    timeoutMs: (Number.isFinite(secs) && secs >= 5 ? Math.min(secs, 120) : 30) * 1000,
  };
}

/** Map a Gemini error to a normalized code. Exported for tests. */
export function mapGeminiError(status, payload) {
  const st = String(payload?.error?.status || '');
  const msg = String(payload?.error?.message || '');
  if (st === 'RESOURCE_EXHAUSTED' || status === 429) return /quota|per day|billing|exceeded your current/i.test(msg) ? E.QUOTA_EXCEEDED : E.RATE_LIMITED;
  if (st === 'UNAUTHENTICATED' || st === 'PERMISSION_DENIED' || /api key not valid|API_KEY_INVALID/i.test(msg)) return E.NOT_CONFIGURED;
  if (st === 'NOT_FOUND' || status === 404) return E.NOT_CONFIGURED; // unknown model name: a configuration problem
  if (st === 'DEADLINE_EXCEEDED') return E.TIMEOUT;
  if (st === 'UNAVAILABLE' || st === 'INTERNAL') return E.UNAVAILABLE;
  return mapHttpStatus(status);
}

/** Pull a JSON object out of model text (tolerates ```json fences). @returns {object|null} */
export function extractJsonObject(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    const a = raw.indexOf('{');
    const b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try {
      const v = JSON.parse(raw.slice(a, b + 1));
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch { return null; }
  }
}

/**
 * @param {{apiKey:string, model:string, baseUrl:string, timeoutMs:number}} cfg
 * @param {{fetchImpl?: typeof fetch}} [deps]
 * @returns {import('./chat-provider.contract.js').ChatProvider}
 */
export function createGeminiAdapter(cfg, { fetchImpl = globalThis.fetch } = {}) {
  const configIssue = () => {
    if (!cfg.apiKey) return 'GEMINI_API_KEY is not set in apps/api/.env';
    if (!cfg.model) return 'GEMINI_CHAT_MODEL is not set in apps/api/.env (choose a current model from the Gemini docs)';
    return null;
  };
  const isConfigured = () => configIssue() === null;

  async function generate({ system, messages, temperature = 0.2, maxOutputTokens = 1024, json = false }) {
    if (!isConfigured()) throw new ProviderError(E.NOT_CONFIGURED, { providerCode: 'NO_LOCAL_CONFIG' });
    const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.text) }] }));
    const body = {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: { temperature, maxOutputTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
    };
    const url = `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent`;
    // A chat call never costs more than a few tokens, so one retry on a transient failure is safe.
    const { ok, status, payload } = await withSafeRetry(async () => {
      const r = await requestJson(fetchImpl, url, { headers: { 'x-goog-api-key': cfg.apiKey }, json: body, timeoutMs: cfg.timeoutMs });
      if (!r.ok) {
        const code = mapGeminiError(r.status, r.payload);
        if (code === E.UNAVAILABLE || code === E.TIMEOUT) throw new ProviderError(code, { providerCode: r.payload?.error?.status || `HTTP_${r.status}`, httpStatus: r.status });
      }
      return r;
    }, 1);
    if (!ok) {
      throw new ProviderError(mapGeminiError(status, payload), {
        providerCode: payload?.error?.status || `HTTP_${status}`, httpStatus: status, providerMessage: payload?.error?.message,
      });
    }
    if (payload?.promptFeedback?.blockReason) throw new ProviderError(E.CONTENT_POLICY, { providerCode: `BLOCKED_${payload.promptFeedback.blockReason}` });
    const cand = payload?.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p) => (typeof p.text === 'string' ? p.text : '')).join('').trim();
    if (!text) {
      const reason = cand?.finishReason;
      throw new ProviderError(reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT' ? E.CONTENT_POLICY : E.GENERATION_FAILED, { providerCode: reason || 'EMPTY_RESPONSE' });
    }
    const u = payload.usageMetadata || {};
    return { text, model: cfg.model, usage: { inputTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount } };
  }

  return {
    id: ID,
    configIssue,
    isConfigured,
    describe: () => ({
      id: ID,
      label: 'Google Gemini',
      operator: 'Google',
      privacyUrl: 'https://ai.google.dev/gemini-api/terms',
      model: cfg.model || null,
      disclosure: [
        'Your chat messages and the product details are sent to Google Gemini to understand your request. Images are not sent to Gemini.',
        'Google\'s Gemini API terms set different data-use rules for free (unpaid) and paid usage. Read the current terms (linked above) before typing anything personal.',
      ],
    }),
    generateResponse: async (req) => {
      const { text, model, usage } = await generate(req);
      return { text, model, usage };
    },
    async understandInstruction(req) {
      const { text, model, usage } = await generate({ ...req, json: true });
      const data = extractJsonObject(text);
      if (!data) throw new ProviderError(E.GENERATION_FAILED, { providerCode: 'INVALID_JSON' });
      return { data, model, usage };
    },
  };
}
