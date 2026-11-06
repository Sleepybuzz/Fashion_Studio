import { PROVIDER_ERROR as E, ProviderError } from '../providers/errors.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Default HTTP status -> normalized code. Adapters refine this with provider-specific knowledge. */
export function mapHttpStatus(status) {
  if (status === 401 || status === 403) return E.NOT_CONFIGURED;
  if (status === 402) return E.QUOTA_EXCEEDED;
  if (status === 408 || status === 504) return E.TIMEOUT;
  if (status === 429) return E.RATE_LIMITED;
  if (status >= 500) return E.UNAVAILABLE;
  return E.GENERATION_FAILED;
}

/**
 * One JSON HTTP call with a hard timeout. Network failures and timeouts become ProviderErrors (never raw errors,
 * never containing URLs or keys). HTTP errors are returned to the adapter (`ok:false`) so it can classify them.
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {{method?:string, headers?:object, json?:any, timeoutMs:number}} opts
 * @returns {Promise<{ok:boolean, status:number, payload:any}>}
 */
export async function requestJson(fetchImpl, url, { method = 'POST', headers = {}, json, timeoutMs }) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { Accept: 'application/json', ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new ProviderError(timedOut ? E.TIMEOUT : E.UNAVAILABLE, { providerCode: timedOut ? 'LOCAL_TIMEOUT' : 'NETWORK_ERROR' });
  }
  let payload = null;
  try { payload = await res.json(); } catch { /* non-JSON body */ }
  return { ok: res.ok, status: res.status, payload };
}

/** Retry an operation that cannot cost money, only for transient failures, never more than `retries` times. */
export async function withSafeRetry(fn, retries = 0) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const transient = err instanceof ProviderError && (err.code === E.UNAVAILABLE || err.code === E.TIMEOUT);
      if (!transient || attempt >= retries) throw err;
      await sleep(400 * (attempt + 1));
    }
  }
}
