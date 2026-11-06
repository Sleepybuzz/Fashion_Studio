import { coverTransform } from './arMath.js';

/** Largest screenshot we upload; the server limit is higher (default 4 MB). */
export const MAX_CAPTURE_BYTES = 3 * 1024 * 1024;

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

/**
 * Compose ONE screenshot of what the customer sees: the current camera frame (same crop and mirroring as on screen)
 * with the garment layer on top. Camera frames are only drawn into this single canvas; nothing else is kept.
 * @param {{video:HTMLVideoElement, garmentCanvas:HTMLCanvasElement, boxW:number, boxH:number, mirrored:boolean, maxSide?:number}} p
 * @returns {Promise<{blob:Blob, width:number, height:number}>}
 */
export async function composeCapture({ video, garmentCanvas, boxW, boxH, mirrored, maxSide = 1440 }) {
  if (!video || video.readyState < 2 || !video.videoWidth) throw new Error('The camera picture is not ready yet.');
  const k = Math.min(window.devicePixelRatio || 1, maxSide / Math.max(boxW, boxH));
  const width = Math.max(2, Math.round(boxW * k));
  const height = Math.max(2, Math.round(boxH * k));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser cannot create the screenshot.');

  const c = coverTransform(video.videoWidth, video.videoHeight, width, height);
  ctx.save();
  if (mirrored) { ctx.translate(width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, c.offsetX, c.offsetY, video.videoWidth * c.scale, video.videoHeight * c.scale);
  ctx.restore();
  // The garment layer is already positioned in the mirrored on-screen space, so it is drawn unflipped.
  ctx.drawImage(garmentCanvas, 0, 0, width, height);

  let blob = null;
  for (const q of [0.88, 0.75, 0.6]) {
    blob = await toBlob(canvas, q);
    if (blob && blob.size <= MAX_CAPTURE_BYTES) break;
  }
  canvas.width = 0; canvas.height = 0; // release the pixel buffer
  if (!blob) throw new Error('The screenshot could not be created.');
  if (blob.size > MAX_CAPTURE_BYTES) throw new Error('The screenshot is too large to save.');
  return { blob, width, height };
}
