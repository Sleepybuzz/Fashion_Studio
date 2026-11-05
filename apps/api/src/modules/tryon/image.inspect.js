/**
 * Dependency-free image header inspection for JPEG, PNG and WebP.
 * It verifies the real file signature (not the client-declared type) and reads the pixel dimensions
 * without decoding the image. Nothing is re-encoded.
 */

export class ImageValidationError extends Error {
  /** @param {string} code stable code @param {string} message customer/admin-safe text */
  constructor(code, message) {
    super(message);
    this.name = 'ImageValidationError';
    this.code = code;
  }
}

const bad = (code, message) => new ImageValidationError(code, message);

function exifOrientation(buf, start, end) {
  // `start` points at "Exif\0\0"; the TIFF header follows.
  const t = start + 6;
  if (t + 8 > end) return 1;
  const le = buf.toString('latin1', t, t + 2) === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  if (u16(t + 2) !== 42) return 1;
  const ifd = t + u32(t + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) break;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

function readJpeg(buf) {
  let off = 2;
  let orientation = 1;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) { off += 1; continue; }
    let marker = buf[off + 1];
    while (marker === 0xff && off + 2 < buf.length) { off += 1; marker = buf[off + 1]; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break;
    const len = buf.readUInt16BE(off + 2);
    if (len < 2 || off + 2 + len > buf.length) throw bad('CORRUPT', 'This image file appears to be damaged.');
    if (marker === 0xe1 && buf.toString('latin1', off + 4, off + 8) === 'Exif') {
      try { orientation = exifOrientation(buf, off + 4, off + 2 + len); } catch { orientation = 1; }
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      if (len < 8) throw bad('CORRUPT', 'This image file appears to be damaged.');
      return { width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5), orientation };
    }
    off += 2 + len;
  }
  throw bad('CORRUPT', 'This image file appears to be damaged.');
}

function readPng(buf) {
  if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') throw bad('CORRUPT', 'This image file appears to be damaged.');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), orientation: 1 };
}

function readWebp(buf) {
  if (buf.length < 30) throw bad('CORRUPT', 'This image file appears to be damaged.');
  const kind = buf.toString('latin1', 12, 16);
  if (kind === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) throw bad('CORRUPT', 'This image file appears to be damaged.');
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, orientation: 1 };
  }
  if (kind === 'VP8L') {
    if (buf[20] !== 0x2f) throw bad('CORRUPT', 'This image file appears to be damaged.');
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, orientation: 1 };
  }
  if (kind === 'VP8X') {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1, orientation: 1 };
  }
  throw bad('CORRUPT', 'This image file appears to be damaged.');
}

/**
 * Detect the real image type from the leading bytes.
 * @param {Buffer} buf
 * @returns {'image/jpeg'|'image/png'|'image/webp'|null}
 */
export function detectImageMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * Validate an uploaded image buffer.
 * `width`/`height` in the result are the *display* dimensions (EXIF rotation of 90 degrees applied).
 * @param {Buffer} buf
 * @param {{minSide:number, maxSide:number, maxPixels:number, maxBytes?:number}} limits
 * @returns {{mime:string, ext:string, width:number, height:number, orientation:number, size:number}}
 * @throws {ImageValidationError}
 */
export function validateImage(buf, limits) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw bad('EMPTY', 'No image was received.');
  if (limits.maxBytes && buf.length > limits.maxBytes) {
    throw bad('TOO_LARGE', `The image is too large (maximum ${Math.round(limits.maxBytes / 1024 / 1024)} MB).`);
  }
  const mime = detectImageMime(buf);
  if (!mime) throw bad('UNSUPPORTED_TYPE', 'Only JPEG, PNG or WebP images are supported.');

  let dims;
  try {
    dims = mime === 'image/jpeg' ? readJpeg(buf) : mime === 'image/png' ? readPng(buf) : readWebp(buf);
  } catch (err) {
    if (err instanceof ImageValidationError) throw err;
    throw bad('CORRUPT', 'This image file appears to be damaged.');
  }
  const swap = dims.orientation >= 5;
  const width = swap ? dims.height : dims.width;
  const height = swap ? dims.width : dims.height;
  if (!(width > 0 && height > 0)) throw bad('CORRUPT', 'This image file appears to be damaged.');
  if (Math.min(width, height) < limits.minSide) {
    throw bad('TOO_SMALL', `The image is too small. The shorter side must be at least ${limits.minSide}px (this one is ${Math.min(width, height)}px).`);
  }
  if (Math.max(width, height) > limits.maxSide || width * height > limits.maxPixels) {
    throw bad('TOO_BIG_DIMENSIONS', `The image dimensions are too large (maximum ${limits.maxSide}px on the longest side).`);
  }
  return { mime, ext: EXT[mime], width, height, orientation: dims.orientation, size: buf.length };
}
