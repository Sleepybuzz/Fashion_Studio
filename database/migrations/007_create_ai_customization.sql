-- Phase 5: AI customization (chat + image editing) and customized-garment try-on.
-- Additive only: no existing table is dropped or recreated. The single change to an existing table is one NULLABLE
-- column (+ index + foreign key) on tryon_sessions, so a try-on can use a customized garment image.
-- Provider-independent: provider / model / provider_metadata are generic columns. Switching AI providers needs NO migration.
-- Date/time columns are DATETIME(3) written by the application (same convention as tryon_sessions).

-- One customization conversation about one garment image.
--   session_type 'product' : started from a store product (the product's image was copied in as the immutable original).
--   session_type 'upload'  : started from a garment photo the customer uploaded (independent of any product).
-- The original image is never modified. current_version_id is the version the next edit builds on (restore moves it);
-- it is intentionally NOT a foreign key (a session and its versions are deleted together).
CREATE TABLE IF NOT EXISTS ai_customization_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  session_type ENUM('product','upload') NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  product_name VARCHAR(200) NULL,
  product_slug VARCHAR(220) NULL,
  title VARCHAR(120) NOT NULL,
  visible_view ENUM('front','back','side','flat_lay','unknown') NOT NULL DEFAULT 'front',
  status ENUM('active','closed') NOT NULL DEFAULT 'active',
  original_key VARCHAR(60) NOT NULL,
  original_mime VARCHAR(40) NOT NULL,
  original_size INT UNSIGNED NOT NULL,
  original_width INT UNSIGNED NOT NULL,
  original_height INT UNSIGNED NOT NULL,
  original_sha256 CHAR(64) NOT NULL,
  current_version_id BIGINT UNSIGNED NULL,
  consent_version VARCHAR(40) NOT NULL,
  consent_chat_provider VARCHAR(40) NOT NULL,
  consent_image_provider VARCHAR(40) NOT NULL,
  consented_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_aics_public_id (public_id),
  UNIQUE KEY uq_aics_original_key (original_key),
  KEY idx_aics_user_updated (user_id, updated_at),
  KEY idx_aics_user_product (user_id, product_id, session_type),
  KEY idx_aics_expires (expires_at),
  CONSTRAINT fk_aics_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_aics_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every successful or failed generation attempt. A version may carry an edited image (output_*), a 3D configuration
-- (config_3d, validated against the product's real Phase 2 options) or both. parent_version_id NULL = built on the original.
CREATE TABLE IF NOT EXISTS ai_customization_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL,
  session_id BIGINT UNSIGNED NOT NULL,
  parent_version_id BIGINT UNSIGNED NULL,
  version_number INT UNSIGNED NOT NULL,
  status ENUM('processing','completed','failed') NOT NULL DEFAULT 'processing',
  image_requested TINYINT(1) NOT NULL DEFAULT 0,
  edit_instruction VARCHAR(1500) NULL,
  structured_changes JSON NULL,
  config_3d JSON NULL,
  output_key VARCHAR(60) NULL,
  output_mime VARCHAR(40) NULL,
  output_size INT UNSIGNED NULL,
  output_width INT UNSIGNED NULL,
  output_height INT UNSIGNED NULL,
  output_sha256 CHAR(64) NULL,
  provider VARCHAR(40) NULL,
  model VARCHAR(120) NULL,
  provider_metadata JSON NULL,
  error_code VARCHAR(40) NULL,
  provider_error_code VARCHAR(60) NULL,
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_aicv_public_id (public_id),
  UNIQUE KEY uq_aicv_session_number (session_id, version_number),
  UNIQUE KEY uq_aicv_output_key (output_key),
  KEY idx_aicv_status_created (status, created_at),
  KEY idx_aicv_image_created (image_requested, created_at),
  KEY idx_aicv_parent (parent_version_id),
  CONSTRAINT fk_aicv_session FOREIGN KEY (session_id) REFERENCES ai_customization_sessions (id) ON DELETE CASCADE,
  CONSTRAINT fk_aicv_parent FOREIGN KEY (parent_version_id) REFERENCES ai_customization_versions (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The conversation. structured_instruction is what the chat provider returned AFTER backend validation (never raw model output).
-- client_request_id makes a double-click / network retry idempotent (one request id = one customer message).
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id BIGINT UNSIGNED NOT NULL,
  sender_type ENUM('user','assistant','system') NOT NULL,
  message TEXT NOT NULL,
  structured_instruction JSON NULL,
  status ENUM('completed','failed') NOT NULL DEFAULT 'completed',
  error_code VARCHAR(40) NULL,
  version_id BIGINT UNSIGNED NULL,
  client_request_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_aicm_request (session_id, client_request_id),
  KEY idx_aicm_session (session_id, id),
  CONSTRAINT fk_aicm_session FOREIGN KEY (session_id) REFERENCES ai_customization_sessions (id) ON DELETE CASCADE,
  CONSTRAINT fk_aicm_version FOREIGN KEY (version_id) REFERENCES ai_customization_versions (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A design the customer chose to keep. design_id links to the Phase 2 "3D designs" row created for it (product sessions with a 3D model).
CREATE TABLE IF NOT EXISTS ai_saved_customizations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NOT NULL,
  version_id BIGINT UNSIGNED NOT NULL,
  design_id BIGINT UNSIGNED NULL,
  title VARCHAR(120) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_aisc_public_id (public_id),
  UNIQUE KEY uq_aisc_version (version_id),
  KEY idx_aisc_user_created (user_id, created_at),
  KEY idx_aisc_session (session_id),
  CONSTRAINT fk_aisc_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_aisc_session FOREIGN KEY (session_id) REFERENCES ai_customization_sessions (id) ON DELETE CASCADE,
  CONSTRAINT fk_aisc_version FOREIGN KEY (version_id) REFERENCES ai_customization_versions (id) ON DELETE CASCADE,
  CONSTRAINT fk_aisc_design FOREIGN KEY (design_id) REFERENCES garment_customizations (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Try-on of a customized garment image: the try-on session records which version supplied the garment image.
-- product_id stays NULL for those sessions (product_name holds the design title). Deleting the version keeps the
-- customer's try-on result (the column becomes NULL).
ALTER TABLE tryon_sessions
  ADD COLUMN customization_version_id BIGINT UNSIGNED NULL AFTER product_id;

ALTER TABLE tryon_sessions
  ADD KEY idx_tryon_custom_version (customization_version_id);

ALTER TABLE tryon_sessions
  ADD CONSTRAINT fk_tryon_sessions_custom_version FOREIGN KEY (customization_version_id) REFERENCES ai_customization_versions (id) ON DELETE SET NULL;

-- Rollback (manual, destructive: only run if you really want to remove the feature's data):
--   ALTER TABLE tryon_sessions DROP FOREIGN KEY fk_tryon_sessions_custom_version, DROP KEY idx_tryon_custom_version, DROP COLUMN customization_version_id;
--   DROP TABLE ai_saved_customizations; DROP TABLE ai_chat_messages; DROP TABLE ai_customization_versions; DROP TABLE ai_customization_sessions;
--   DELETE FROM schema_migrations WHERE name = '007_create_ai_customization.sql';
-- Stored files under UPLOAD_DIR/private/ai must be deleted separately.
