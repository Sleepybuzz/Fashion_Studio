/**
 * Dependency-free check whether a PNG or WebP file declares transparency. Used to reject opaque
 * "overlay" uploads (a garment with a solid background would cover the customer's whole camera image).
 * It reads headers only; it does not decode pixels, so a fully opaque image that merely has an alpha
 * channel is still accepted (the admin preview shows what customers will see).
 */

/** @param {Buffer} buf @returns {boolean} */
function pngHasAlpha(buf) {
  if (buf.length < 33) return false;
  const colorType = buf[25];
  if (colorType === 4 || colorType === 6) return true; // grey+alpha / RGBA
  if (colorType !== 3) return false; // greyscale / RGB without tRNS cannot be transparent
  // Palette image: transparent only when a tRNS chunk precedes the pixel data.
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (type === 'tRNS') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    off += 12 + len;
  }
  return false;
}

/** @param {Buffer} buf @returns {boolean} */
function webpHasAlpha(buf) {
  if (buf.length < 30) return false;
  const kind = buf.toString('latin1', 12, 16);
  if (kind === 'VP8X') return (buf[20] & 0x10) !== 0; // alpha flag in the extended header
  if (kind === 'VP8L') return buf[20] === 0x2f && ((buf.readUInt32LE(21) >>> 28) & 1) === 1; // alpha_is_used bit
  return false; // plain lossy VP8 has no alpha
}

/**
 * @param {Buffer} buf
 * @param {'image/png'|'image/webp'|string} mime real (sniffed) type
 * @returns {boolean}
 */
export function imageHasAlpha(buf, mime) {
  if (mime === 'image/png') return pngHasAlpha(buf);
  if (mime === 'image/webp') return webpHasAlpha(buf);
  return false;
}
