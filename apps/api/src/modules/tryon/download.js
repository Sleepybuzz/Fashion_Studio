/** Safe download of the generated image from the provider's temporary URL. No third-party imports. */

/**
 * Only https URLs to public hosts. The URL comes from the provider's own API response, so this is
 * defence-in-depth against SSRF rather than a primary control.
 * @param {string} value
 */
export function isSafeRemoteUrl(value) {
  let u;
  try { u = new URL(value); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host.includes(':') || host.startsWith('[')) return false; // IPv6 literals
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  return true;
}

/**
 * @param {string} url
 * @param {{maxBytes:number, timeoutMs?:number, fetchImpl?:typeof fetch}} opts
 * @returns {Promise<Buffer>}
 */
export async function downloadImage(url, { maxBytes, timeoutMs = 20_000, fetchImpl = globalThis.fetch }) {
  if (!isSafeRemoteUrl(url)) throw new Error('Unsafe result URL');
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (res.url && !isSafeRemoteUrl(res.url)) throw new Error('Unsafe redirect target');
  if (!res.ok) throw new Error(`Result download failed with HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length'));
  if (declared && declared > maxBytes) throw new Error('Result image is too large');
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Result image is too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
