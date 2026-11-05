/** Shared constants for the virtual try-on module (no third-party imports: safe to unit-test). */

export const TRYON_STATUS = Object.freeze({
  VALIDATING: 'validating',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

/** A customer may only have one session in these states at a time (duplicate / repeated paid request protection). */
export const ACTIVE_STATUSES = Object.freeze([TRYON_STATUS.VALIDATING, TRYON_STATUS.PROCESSING]);

export const ALLOWED_IMAGE_MIMES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const EXT_FOR_MIME = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });

export const IMAGE_LIMITS = Object.freeze({
  /** Customer photos. The web app resizes to 2048px before upload; these are server-side guards. */
  photo: { minSide: 480, maxSide: 8000, maxPixels: 40_000_000 },
  /** Admin garment photos. */
  garment: { minSide: 400, maxSide: 8000, maxPixels: 40_000_000, maxPerProduct: 4 },
});

/** Largest generated image we accept back from a provider. */
export const MAX_RESULT_BYTES = 15 * 1024 * 1024;

/** Customers can manually retry a failed session this many times in total. */
export const MAX_ATTEMPTS = 3;

export const AI_DESCRIPTION_MAX = 500;

/** Bump when the wording of the consent text changes materially. The provider id is appended automatically. */
export const CONSENT_TEMPLATE_VERSION = 'v1';

/** How long a failed session (and its stored photo) is kept so the customer can retry without re-uploading. */
export const FAILED_RETENTION_HOURS = 24;
