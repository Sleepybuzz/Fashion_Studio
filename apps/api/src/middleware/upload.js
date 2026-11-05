import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { badRequest } from '../utils/AppError.js';

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** Upload sub-folder for public product images. Future phases add private folders. */
export const PRODUCT_IMAGE_DIR = path.join(env.uploadDir, 'products');
fs.mkdirSync(PRODUCT_IMAGE_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PRODUCT_IMAGE_DIR),
  // Random server-generated filename; the client's name is never used on disk.
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED[file.mimetype]}`),
});

export const productImageUpload = multer({
  storage,
  limits: { fileSize: env.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED[file.mimetype]) return cb(badRequest('Only JPEG, PNG or WebP images are allowed'));
    return cb(null, true);
  },
}).single('image');

/** Verify file signature (magic bytes) matches an allowed image type; delete if not. */
export function verifyImageSignature(filePath) {
  const buf = Buffer.alloc(12);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  return isJpg || isPng || isWebp;
}

// ---------------------------------------------------------------------------
// Phase 2: private 3D garment model uploads (.glb / .gltf)
// ---------------------------------------------------------------------------

/** Private folder for 3D models. NOT served statically; files are streamed by an authorised route. */
export const GARMENT_DIR = path.join(env.privateDir, 'garments');
fs.mkdirSync(GARMENT_DIR, { recursive: true });

const MODEL_FORMATS = { '.glb': 'glb', '.gltf': 'gltf' };
// Browsers often send application/octet-stream (or an empty type) for .glb; content is verified separately.
const MODEL_MIMES = new Set(['model/gltf-binary', 'model/gltf+json', 'application/octet-stream', 'application/json', 'application/gltf-buffer', '']);

/** @returns {'glb'|'gltf'|undefined} */
export const modelFormatFromName = (name) => MODEL_FORMATS[path.extname(String(name)).toLowerCase()];

export const garmentModelUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, GARMENT_DIR),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}.${modelFormatFromName(file.originalname)}`),
  }),
  limits: { fileSize: env.maxModelBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!modelFormatFromName(file.originalname)) return cb(badRequest('Only .glb or .gltf 3D model files are allowed'));
    if (!MODEL_MIMES.has(file.mimetype)) return cb(badRequest('Unsupported file type for a 3D model'));
    return cb(null, true);
  },
}).single('model');
