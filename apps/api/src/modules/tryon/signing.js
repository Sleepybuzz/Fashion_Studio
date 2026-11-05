import crypto from 'node:crypto';

/**
 * Short-lived signed URLs for private images.
 * `<img>` tags cannot send an Authorization header, so private files are served from a URL that carries an
 * HMAC signature binding (kind, id, user, expiry). The signing key is derived from JWT_SECRET but is a
 * different value, so a JWT can never be used as a file signature (and vice versa).
 */

const LABEL = 'afs-tryon-asset-v1';

/** @param {string} secret */
export const deriveSigningKey = (secret) => crypto.createHmac('sha256', String(secret)).update(LABEL).digest();

const mac = (key, kind, id, userId, exp) =>
  crypto.createHmac('sha256', key).update(`${kind}|${id}|${userId}|${exp}`).digest('hex');

/**
 * @param {Buffer} key
 * @param {{kind:string, id:string|number, userId:number, ttlSeconds:number, nowMs?:number}} p
 * @returns {{exp:number, u:number, sig:string}}
 */
export function signAsset(key, { kind, id, userId, ttlSeconds, nowMs = Date.now() }) {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  return { exp, u: userId, sig: mac(key, kind, id, userId, exp) };
}

/**
 * @param {Buffer} key
 * @param {{kind:string, id:string|number, exp:string|number, u:string|number, sig:string, nowMs?:number}} p
 * @returns {boolean}
 */
export function verifyAsset(key, { kind, id, exp, u, sig, nowMs = Date.now() }) {
  const expNum = Number(exp);
  const userNum = Number(u);
  if (!Number.isInteger(expNum) || !Number.isInteger(userNum) || typeof sig !== 'string') return false;
  if (expNum * 1000 < nowMs) return false;
  const expected = Buffer.from(mac(key, kind, id, userNum, expNum), 'hex');
  let given;
  try { given = Buffer.from(sig, 'hex'); } catch { return false; }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Relative API path (the web app prefixes the API origin). */
export function signedPath(key, apiPrefix, { kind, id, userId, ttlSeconds, nowMs }) {
  const { exp, u, sig } = signAsset(key, { kind, id, userId, ttlSeconds, nowMs });
  return `${apiPrefix}/tryon/assets/${kind}/${encodeURIComponent(id)}?exp=${exp}&u=${u}&sig=${sig}`;
}
