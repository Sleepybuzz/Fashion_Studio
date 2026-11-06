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

// ---------------------------------------------------------------------------
// Phase 3: virtual try-on image uploads (customer photo, admin garment photos)
// ---------------------------------------------------------------------------

const TRYON_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * In-memory single-image upload. Nothing touches disk until the content has been verified (real signature,
 * dimensions) and a server-generated name is chosen. The declared MIME type is only a first filter.
 * @param {string} field multipart field name
 * @param {number} maxBytes
 */
const memoryImageUpload = (field, maxBytes) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxBytes, files: 1, fields: 10, fieldSize: 1024 },
  fileFilter: (_req, file, cb) => (TRYON_MIMES.has(file.mimetype)
    ? cb(null, true)
    : cb(badRequest('Only JPEG, PNG or WebP images are allowed'))),
}).single(field);

/** Customer photo for virtual try-on (multipart field `photo`). */
export const tryOnPhotoUpload = memoryImageUpload('photo', env.tryon.maxPhotoBytes);
/** Admin AI-ready garment photo (multipart field `image`). */
export const tryOnGarmentUpload = memoryImageUpload('image', env.tryon.maxGarmentBytes);

// ---------------------------------------------------------------------------
// Phase 4: AR try-on uploads (customer screenshot, admin transparent garment overlay)
// ---------------------------------------------------------------------------

/** Screenshot the customer chose to save (multipart field `image`). Same in-memory, verify-before-write approach as Phase 3. */
export const arCaptureUpload = memoryImageUpload('image', env.ar.maxCaptureBytes);
/** Admin transparent garment overlay (multipart field `overlay`). */
export const arOverlayUpload = memoryImageUpload('overlay', env.ar.maxOverlayBytes);

// ---------------------------------------------------------------------------
// Phase 5: AI customization garment upload (multipart field `image`). Allowed types and the size limit come from
// AI_UPLOAD_ALLOWED_TYPES / MAX_AI_UPLOAD_MB; the real content is verified again by the service (signature, dimensions).
// ---------------------------------------------------------------------------

/** In-memory single garment image for AI customization. Optional: a product session sends no file. */
export const aiImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.ai.maxUploadBytes, files: 1, fields: 12, fieldSize: 2048 },
  fileFilter: (_req, file, cb) => (env.ai.uploadTypes.includes(String(file.mimetype).toLowerCase())
    ? cb(null, true)
    : cb(badRequest('This image format is not accepted. Use JPEG, PNG or WebP.'))),
}).single('image');
