import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { bunnyDelete, bunnyGet, bunnyPipe, bunnyPublicUrl, bunnyPut } from './bunny.js';

/** true when STORAGE_DRIVER=bunny (files live on Bunny.net instead of the server's disk). */
export const usingBunny = () => env.storageDriver === 'bunny';

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', glb: 'model/gltf-binary', gltf: 'model/gltf+json' };
const contentTypeOf = (name) => MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';
const join = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');

/**
 * One folder of files, stored either on local disk (STORAGE_DRIVER=local) or on Bunny.net (STORAGE_DRIVER=bunny).
 * Names must be server-generated; anything with a slash, "..", or a leading dot is rejected.
 * @param {{localDir:string, remoteDir:string}} opts remoteDir is relative to BUNNY_BASE_PATH
 */
export function createObjectStore({ localDir, remoteDir }) {
  const check = (name) => {
    if (typeof name !== 'string' || !SAFE_NAME.test(name)) throw new Error('Invalid storage key');
    return name;
  };
  const remote = (name) => join(env.bunny.basePath, remoteDir, check(name));
  return {
    localDir,
    remoteDir,
    async put(name, buffer) {
      check(name);
      if (usingBunny()) return bunnyPut(remote(name), buffer, contentTypeOf(name));
      await fs.mkdir(localDir, { recursive: true });
      return fs.writeFile(path.join(localDir, name), buffer, { flag: 'wx', mode: 0o600 });
    },
    async get(name) {
      check(name);
      return usingBunny() ? bunnyGet(remote(name)) : fs.readFile(path.join(localDir, name));
    },
    /** @returns {Promise<boolean>} false when the file did not exist */
    async remove(name) {
      check(name);
      if (usingBunny()) return bunnyDelete(remote(name));
      try { await fs.unlink(path.join(localDir, name)); return true; } catch (err) {
        if (err.code === 'ENOENT') return false;
        throw err;
      }
    },
    /** Stream to an Express response. `cb(err)` is called on failure (err.code === 'ENOENT' when missing). */
    send(res, name, cb) {
      check(name);
      if (usingBunny()) return bunnyPipe(res, remote(name), cb);
      return res.sendFile(name, { root: localDir, dotfiles: 'deny' }, cb);
    },
    /** Public URL (only meaningful for public folders such as product images). */
    publicUrl(name) {
      return usingBunny() ? bunnyPublicUrl(remote(name)) : null;
    },
  };
}

const uploadRoot = env.uploadDir;
/** Public catalogue images. Bunny: served from the CDN pull zone. Local: served by Express at /uploads/products. */
export const productStore = createObjectStore({ localDir: path.join(uploadRoot, 'products'), remoteDir: 'products' });
/** Private 3D garment models. Always streamed through an authorised API route. */
export const garmentStore = createObjectStore({ localDir: path.join(env.privateDir, 'garments'), remoteDir: 'private/garments' });

/** Store a verified product image and return the URL to save on the product. */
export async function saveProductImage(buffer, ext) {
  const name = `${crypto.randomUUID()}.${ext}`;
  await productStore.put(name, buffer);
  return productStore.publicUrl(name) || `/uploads/products/${name}`;
}