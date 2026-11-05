/** Client-side photo helpers. The server re-validates everything; this is for fast feedback and privacy. */

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** Reject absurdly large originals before decoding them in the browser (they are resized to ~2 MP anyway). */
export const MAX_INPUT_BYTES = 40 * 1024 * 1024;

/**
 * Scale (w, h) down so the longest side is at most `max`. Never upscales.
 * @returns {{width:number, height:number}}
 */
export function fitWithin(w, h, max) {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** @returns {string|null} a user-facing problem, or null when the file looks usable */
export function checkPickedFile(file) {
  if (!file) return 'No file selected.';
  if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) {
    return 'HEIC photos are not supported. Please choose a JPEG, PNG or WebP image, or take the photo with your camera.';
  }
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Please choose a JPEG, PNG or WebP image.';
  if (file.size > MAX_INPUT_BYTES) return 'This file is too large. Please choose a photo under 40 MB.';
  return null;
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // 'from-image' applies the EXIF rotation so portrait phone photos are not sideways.
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close?.() };
    } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Decode, apply EXIF orientation, resize to at most `maxSide` and re-encode as JPEG.
 * Re-encoding drops all metadata (GPS location, camera, timestamps), so it is not sent to anyone.
 * @param {File} file
 * @param {{maxSide?:number, minSide:number, maxBytes:number, quality?:number}} opts
 * @returns {Promise<{file:File, width:number, height:number, previewUrl:string}>}
 */
export async function preparePhoto(file, { maxSide = 2048, minSide, maxBytes, quality = 0.9 }) {
  let img;
  try {
    img = await decode(file);
  } catch {
    throw new Error('We could not read this image. Try a different photo.');
  }
  try {
    if (Math.min(img.width, img.height) < minSide) {
      throw new Error(`This photo is too small. The shorter side must be at least ${minSide}px (yours is ${Math.min(img.width, img.height)}px).`);
    }
    const { width, height } = fitWithin(img.width, img.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser cannot process this image.');
    ctx.fillStyle = '#ffffff'; // transparent PNGs become white instead of black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img.source, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Your browser cannot process this image.');
    if (blob.size > maxBytes) throw new Error(`The prepared photo is larger than ${Math.round(maxBytes / 1024 / 1024)} MB. Try a smaller photo.`);
    const out = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    return { file: out, width, height, previewUrl: URL.createObjectURL(out) };
  } finally {
    img.close();
  }
}
