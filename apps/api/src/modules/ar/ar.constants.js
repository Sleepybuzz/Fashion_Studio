/** Shared constants for the real-time AR try-on module (no third-party imports: safe to unit-test). */

export const GARMENT_TYPES = Object.freeze(['top', 'outerwear']);
export const ASSET_MODES = Object.freeze(['model3d', 'overlay2d']);

/** Bump when the wording of the "save my screenshot" consent changes materially. */
export const AR_CONSENT_VERSION = 'ar-v1';

export const SCALE_ADJUST = Object.freeze({ min: 0.5, max: 1.6, default: 1 });
export const OFFSET_Y_ADJUST = Object.freeze({ min: -0.3, max: 0.3, default: 0 });

/** Screenshot limits (the web app downsizes to <= 1440px on the long side before upload; these are server-side guards). */
export const CAPTURE_LIMITS = Object.freeze({ minSide: 240, maxSide: 4096, maxPixels: 16_000_000 });
/** Transparent overlay limits. */
export const OVERLAY_LIMITS = Object.freeze({ minSide: 400, maxSide: 4096, maxPixels: 16_000_000 });
/** Overlays need an alpha channel, so JPEG is not accepted. */
export const OVERLAY_MIMES = Object.freeze(['image/png', 'image/webp']);

/** Largest serialized customization snapshot accepted with a capture (bytes). */
export const MAX_CONFIG_BYTES = 1000;

/**
 * "AR eligible" = active product + AR enabled by the store owner + the asset the chosen mode needs actually exists.
 * Used as `WHERE` fragment on `product_ar_configs c JOIN products p`. Kept in one place so the product page flag,
 * the customer endpoint and the admin list can never disagree.
 */
export const AR_ELIGIBLE_SQL = `p.status = 'active' AND c.enabled = 1 AND (
  (c.asset_mode = 'model3d' AND EXISTS (SELECT 1 FROM garment_assets a WHERE a.product_id = p.id))
  OR (c.asset_mode = 'overlay2d' AND c.overlay_key IS NOT NULL))`;
