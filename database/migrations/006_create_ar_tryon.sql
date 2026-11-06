-- Phase 4: Real-Time AR Try-On. Additive only: no existing table is altered or dropped.
-- Tracking runs in the customer's browser; the database only stores (a) per-product AR settings and
-- (b) screenshots a customer explicitly chose to save. No camera frames or landmarks are ever stored.
-- Date/time columns of ar_captures are DATETIME(3) written by the application (same convention as tryon_sessions).

-- Per-product AR settings. Kept in its own table so products / garment_assets / product_tryon_* are untouched.
--   asset_mode 'model3d'   -> uses the Phase 2 GLB/GLTF model of the product (garment_assets).
--   asset_mode 'overlay2d' -> uses a transparent PNG/WebP garment overlay uploaded for AR (stored privately on disk).
--   garment_type selects the positioning profile. Only upper-body profiles exist in this phase.
--   scale_adjust / offset_y_adjust are per-asset calibration knobs (x1.00 = profile default; offset is a fraction of torso height).
CREATE TABLE IF NOT EXISTS product_ar_configs (
  product_id BIGINT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  garment_type ENUM('top','outerwear') NOT NULL DEFAULT 'top',
  asset_mode ENUM('model3d','overlay2d') NOT NULL DEFAULT 'model3d',
  scale_adjust DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  offset_y_adjust DECIMAL(4,2) NOT NULL DEFAULT 0.00,
  overlay_key VARCHAR(60) NULL,
  overlay_name VARCHAR(255) NULL,
  overlay_mime VARCHAR(40) NULL,
  overlay_size INT UNSIGNED NULL,
  overlay_width INT UNSIGNED NULL,
  overlay_height INT UNSIGNED NULL,
  overlay_sha256 CHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id),
  UNIQUE KEY uq_ar_cfg_overlay_key (overlay_key),
  CONSTRAINT fk_ar_cfg_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Screenshots a customer chose to save. The image file lives in private storage (UPLOAD_DIR/private/ar/captures),
-- never in MySQL and never served statically. If a product is later deleted the capture is kept (product_id becomes NULL;
-- name/slug are snapshots). `config` is the colour/material/style selection that was on screen (nothing about the body).
CREATE TABLE IF NOT EXISTS ar_captures (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  product_name VARCHAR(200) NOT NULL,
  product_slug VARCHAR(220) NULL,
  render_mode ENUM('model3d','overlay2d') NOT NULL,
  capture_key VARCHAR(60) NOT NULL,
  capture_mime VARCHAR(40) NOT NULL,
  capture_size INT UNSIGNED NOT NULL,
  capture_width INT UNSIGNED NOT NULL,
  capture_height INT UNSIGNED NOT NULL,
  config JSON NULL,
  consent_version VARCHAR(30) NOT NULL,
  consented_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ar_cap_public_id (public_id),
  UNIQUE KEY uq_ar_cap_key (capture_key),
  KEY idx_ar_cap_user_created (user_id, created_at),
  KEY idx_ar_cap_expires (expires_at),
  KEY idx_ar_cap_product (product_id),
  CONSTRAINT fk_ar_cap_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_ar_cap_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback (manual, destructive: only run if you really want to remove the feature's data):
--   DROP TABLE ar_captures; DROP TABLE product_ar_configs;
--   DELETE FROM schema_migrations WHERE name = '006_create_ar_tryon.sql';
-- Stored files under UPLOAD_DIR/private/ar must be deleted separately.
