-- Phase 3: AI Photo Virtual Try-On. Additive only: no existing table is altered or dropped.
-- Date/time columns of tryon_sessions are DATETIME(3) and are always written by the application
-- (never CURRENT_TIMESTAMP), so comparisons use one clock and do not depend on the MySQL time zone.

-- Per-product virtual try-on settings. Kept in its own table so the Phase 1 "products" table is untouched.
CREATE TABLE IF NOT EXISTS product_tryon_configs (
  product_id BIGINT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  ai_description VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id),
  CONSTRAINT fk_tryon_cfg_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AI-ready garment photos (flat lay / on-model). Files live in private storage, never in MySQL and never served publicly.
CREATE TABLE IF NOT EXISTS product_tryon_images (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  storage_key VARCHAR(60) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(40) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  width INT UNSIGNED NOT NULL,
  height INT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tryon_img_key (storage_key),
  KEY idx_tryon_img_product (product_id, sort_order, id),
  CONSTRAINT fk_tryon_img_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per try-on request. Provider-neutral: provider-specific values are limited to provider / provider_job_id.
-- If a product is later deleted the customer's result is kept (product_id becomes NULL; name/slug are snapshots).
CREATE TABLE IF NOT EXISTS tryon_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  product_name VARCHAR(200) NOT NULL,
  product_slug VARCHAR(220) NULL,
  status ENUM('validating','processing','completed','failed') NOT NULL DEFAULT 'validating',
  provider VARCHAR(40) NOT NULL,
  provider_job_id VARCHAR(120) NULL,
  is_test TINYINT(1) NOT NULL DEFAULT 0,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 1,
  photo_key VARCHAR(60) NOT NULL,
  photo_mime VARCHAR(40) NOT NULL,
  photo_size INT UNSIGNED NOT NULL,
  photo_width INT UNSIGNED NOT NULL,
  photo_height INT UNSIGNED NOT NULL,
  result_key VARCHAR(60) NULL,
  result_mime VARCHAR(40) NULL,
  result_size INT UNSIGNED NULL,
  consent_version VARCHAR(30) NOT NULL,
  consent_provider VARCHAR(40) NOT NULL,
  consented_at DATETIME(3) NOT NULL,
  error_code VARCHAR(40) NULL,
  provider_error_code VARCHAR(60) NULL,
  saved_at DATETIME(3) NULL,
  expires_at DATETIME(3) NULL,
  submitted_at DATETIME(3) NULL,
  last_polled_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tryon_public_id (public_id),
  KEY idx_tryon_user_created (user_id, created_at),
  KEY idx_tryon_user_status (user_id, status),
  KEY idx_tryon_status_updated (status, updated_at),
  KEY idx_tryon_expires (expires_at),
  KEY idx_tryon_product (product_id),
  CONSTRAINT fk_tryon_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_tryon_sessions_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback (manual, destructive: only run if you really want to remove the feature's data):
--   DROP TABLE tryon_sessions; DROP TABLE product_tryon_images; DROP TABLE product_tryon_configs;
--   DELETE FROM schema_migrations WHERE name = '005_create_virtual_tryon.sql';
-- Stored files under UPLOAD_DIR/private/tryon must be deleted separately.
