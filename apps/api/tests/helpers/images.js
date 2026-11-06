import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/**
 * A real, decodable PNG. `alpha: true` -> RGBA with a transparent border; otherwise opaque RGB.
 * @param {number} w @param {number} h @param {{alpha?:boolean}} [opts]
 */
export function makePng(w, h, { alpha = false } = {}) {
  const bpp = alpha ? 4 : 3;
  const raw = Buffer.alloc((w * bpp + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * (w * bpp + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x += 1) {
      const o = row + 1 + x * bpp;
      const inside = x > w * 0.2 && x < w * 0.8 && y > h * 0.1 && y < h * 0.9;
      raw[o] = inside ? 40 : 255; raw[o + 1] = inside ? 90 : 255; raw[o + 2] = inside ? 200 : 255;
      if (alpha) raw[o + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Minimal JPEG header + SOF0 (enough for server-side signature and dimension checks; not a decodable picture). */
export function fakeJpeg(w, h) {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9, 0x00, 0x00,
  ]);
}
