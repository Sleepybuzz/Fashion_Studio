import { Readable } from 'node:stream';
import { env } from '../config/env.js';

/**
 * Minimal Bunny.net Edge Storage client (REST API). Credentials come ONLY from apps/api/.env and never leave the server.
 * Docs: https://docs.bunny.net/reference/storage-api
 */
const cfg = () => env.bunny;
const enc = (p) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
const urlFor = (remotePath) => `https://${cfg().host}/${encodeURIComponent(cfg().storageZone)}/${enc(remotePath)}`;
const headers = (extra = {}) => ({ AccessKey: cfg().accessKey, ...extra });
const enoent = (msg) => Object.assign(new Error(msg), { code: 'ENOENT' });

async function call(method, remotePath, init = {}) {
  try {
    return await fetch(urlFor(remotePath), {
      method,
      ...init,
      headers: headers(init.headers),
      signal: AbortSignal.timeout(cfg().timeoutMs),
    });
  } catch (err) {
    throw new Error(`Bunny storage ${method} failed: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
  }
}

/** Upload (create or overwrite) a file. */
export async function bunnyPut(remotePath, buffer, contentType = 'application/octet-stream') {
  const r = await call('PUT', remotePath, { body: buffer, headers: { 'Content-Type': contentType } });
  if (!r.ok) throw new Error(`Bunny storage upload failed (HTTP ${r.status}). Check BUNNY_STORAGE_ZONE, BUNNY_STORAGE_ACCESS_KEY and BUNNY_STORAGE_HOST.`);
}

/** Download a file into memory. Throws an ENOENT error when it does not exist. */
export async function bunnyGet(remotePath) {
  const r = await call('GET', remotePath);
  if (r.status === 404) throw enoent('File not found');
  if (!r.ok) throw new Error(`Bunny storage download failed (HTTP ${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

/** Delete a file. @returns {Promise<boolean>} false when it was already gone. */
export async function bunnyDelete(remotePath) {
  const r = await call('DELETE', remotePath);
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(`Bunny storage delete failed (HTTP ${r.status})`);
  return true;
}

/** Stream a private file to an Express response (the storage zone itself is never exposed to browsers). */
export async function bunnyPipe(res, remotePath, cb) {
  let r;
  try {
    r = await call('GET', remotePath);
  } catch (err) { return cb(err); }
  if (r.status === 404) return cb(enoent('File not found'));
  if (!r.ok || !r.body) return cb(new Error(`Bunny storage download failed (HTTP ${r.status})`));
  const len = r.headers.get('content-length');
  if (len) res.setHeader('Content-Length', len);
  const stream = Readable.fromWeb(r.body);
  stream.on('error', (err) => { if (res.headersSent) res.destroy(err); else cb(err); });
  return stream.pipe(res);
}

/** Public CDN URL (Pull Zone) for a file stored under a public folder. */
export const bunnyPublicUrl = (remotePath) => `${cfg().cdnUrl}/${enc(remotePath)}`;
