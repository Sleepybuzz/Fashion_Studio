import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const STORAGE_KINDS = Object.freeze(['photos', 'results', 'garments']);
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export const isValidStorageKey = (key) => typeof key === 'string' && KEY_RE.test(key);

/**
 * Private on-disk storage for try-on images (customer photos, generated results, admin garment photos).
 * The root is NOT served statically; files are streamed by authorised/signed routes only.
 * File names are server-generated random UUIDs, so client-provided names never touch the file system.
 * Phase 4 reuses this factory (with its own root and kinds) for AR captures and overlays.
 * @param {string} rootDir
 * @param {readonly string[]} [kinds] allowed sub-folders (defaults to the try-on kinds)
 */
export function createTryOnStorage(rootDir, kinds = STORAGE_KINDS) {
  const dirFor = (kind) => {
    if (!kinds.includes(kind)) throw new Error(`Unknown storage kind: ${kind}`);
    return path.join(rootDir, kind);
  };
  const fileFor = (kind, key) => {
    if (!isValidStorageKey(key)) throw new Error('Invalid storage key');
    return path.join(dirFor(kind), key);
  };

  return {
    rootDir,
    dirFor,
    /** @returns {Promise<string>} the new storage key */
    async save(kind, buffer, ext) {
      const dir = dirFor(kind);
      await fs.mkdir(dir, { recursive: true });
      const key = `${crypto.randomUUID()}.${ext}`;
      if (!isValidStorageKey(key)) throw new Error('Unsupported file extension');
      await fs.writeFile(path.join(dir, key), buffer, { flag: 'wx', mode: 0o600 });
      return key;
    },
    async read(kind, key) {
      return fs.readFile(fileFor(kind, key));
    },
    /** Delete a file; a missing file is not an error. Never throws for invalid keys (returns false). */
    async remove(kind, key) {
      if (!key || !isValidStorageKey(key)) return false;
      try {
        await fs.unlink(fileFor(kind, key));
        return true;
      } catch (err) {
        if (err.code === 'ENOENT') return false;
        throw err;
      }
    },
  };
}
