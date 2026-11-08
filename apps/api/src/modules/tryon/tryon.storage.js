import crypto from 'node:crypto';
import path from 'node:path';
import { createObjectStore } from '../../storage/index.js';

export const STORAGE_KINDS = Object.freeze(['photos', 'results', 'garments']);
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export const isValidStorageKey = (key) => typeof key === 'string' && KEY_RE.test(key);

/**
 * Private storage for try-on images (customer photos, generated results, admin garment photos).
 * Files live on local disk (STORAGE_DRIVER=local) or on Bunny.net Edge Storage (STORAGE_DRIVER=bunny).
 * Either way they are NOT public: files are streamed by authorised/signed API routes only.
 * File names are server-generated random UUIDs, so client-provided names never reach the file system or the CDN.
 * Phase 4 and Phase 5 reuse this factory (with their own root and kinds) for AR captures/overlays and AI images.
 * @param {string} rootDir local root (its last folder name, e.g. "tryon", "ar", "ai", is also the folder name on Bunny)
 * @param {readonly string[]} [kinds] allowed sub-folders (defaults to the try-on kinds)
 */
export function createTryOnStorage(rootDir, kinds = STORAGE_KINDS) {
  const stores = new Map();
  const storeFor = (kind) => {
    if (!kinds.includes(kind)) throw new Error(`Unknown storage kind: ${kind}`);
    if (!stores.has(kind)) {
      stores.set(kind, createObjectStore({ localDir: path.join(rootDir, kind), remoteDir: `private/${path.basename(rootDir)}/${kind}` }));
    }
    return stores.get(kind);
  };
  const checked = (kind, key) => {
    const store = storeFor(kind);
    if (!isValidStorageKey(key)) throw new Error('Invalid storage key');
    return store;
  };

  return {
    rootDir,
    /** Local folder for a kind (only meaningful with STORAGE_DRIVER=local). */
    dirFor(kind) {
      storeFor(kind);
      return path.join(rootDir, kind);
    },
    /** @returns {Promise<string>} the new storage key */
    async save(kind, buffer, ext) {
      const store = storeFor(kind);
      const key = `${crypto.randomUUID()}.${ext}`;
      if (!isValidStorageKey(key)) throw new Error('Unsupported file extension');
      await store.put(key, buffer);
      return key;
    },
    async read(kind, key) {
      return checked(kind, key).get(key);
    },
    /** Delete a file; a missing file is not an error. Never throws for invalid keys (returns false). */
    async remove(kind, key) {
      if (!key || !isValidStorageKey(key)) return false;
      return storeFor(kind).remove(key);
    },
    /** Stream a file to an Express response. `cb(err)` on failure; err.code === 'ENOENT' when the file is missing. */
    send(res, kind, key, cb) {
      return checked(kind, key).send(res, key, cb);
    },
  };
}