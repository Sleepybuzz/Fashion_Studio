-- Phase 2: 3D Garment Studio. Additive only; no existing table is altered or dropped.

-- One 3D model per product. The binary file lives on disk (private storage), never in MySQL.
CREATE TABLE IF NOT EXISTS garment_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  storage_key VARCHAR(120) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  format ENUM('glb','gltf') NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  model_info JSON NOT NULL,
  customizable_materials JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_garment_assets_product (product_id),
  UNIQUE KEY uq_garment_assets_storage_key (storage_key),
  CONSTRAINT fk_garment_assets_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin-defined style options (e.g. Sleeves, Neckline, Length). Each value shows/hides named nodes
-- that already exist inside the product's single GLB/GLTF file.
CREATE TABLE IF NOT EXISTS customization_options (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  option_key VARCHAR(40) NOT NULL,
  label VARCHAR(60) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_custopt_product_key (product_id, option_key),
  CONSTRAINT fk_custopt_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customization_values (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  option_id BIGINT UNSIGNED NOT NULL,
  value_key VARCHAR(40) NOT NULL,
  label VARCHAR(60) NOT NULL,
  show_nodes JSON NOT NULL,
  hide_nodes JSON NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_custval_option_key (option_id, value_key),
  CONSTRAINT fk_custval_option FOREIGN KEY (option_id) REFERENCES customization_options (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Customer-owned saved designs. If a model is removed the design is kept (asset_id becomes NULL).
CREATE TABLE IF NOT EXISTS garment_customizations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  asset_id BIGINT UNSIGNED NULL,
  name VARCHAR(80) NOT NULL,
  config JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_garment_cust_user (user_id, updated_at),
  KEY idx_garment_cust_product (product_id),
  KEY idx_garment_cust_asset (asset_id),
  CONSTRAINT fk_garment_cust_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_garment_cust_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT fk_garment_cust_asset FOREIGN KEY (asset_id) REFERENCES garment_assets (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
