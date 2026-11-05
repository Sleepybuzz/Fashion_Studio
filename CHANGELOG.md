# Changelog

## [0.2.0] - Phase 2: 3D Garment Studio and Customization

### Added
- **3D Garment Studio** (`/studio/:slug`): React Three Fiber viewer with GLB/GLTF loading, rotate/zoom/pan (mouse and touch), zoom buttons, auto-rotate, reset camera, loading, error, no-WebGL and "no model" states, procedural lighting (no third-party HDR download), on-demand rendering, resource disposal.
- Customization panel: 14 colour presets, 6 material finish presets (roughness / metalness / sheen where the model supports it), admin-defined style options (sleeves, neckline, length...) implemented as show/hide of named nodes inside the model, reset, save.
- Saved designs for customers: save, list, reopen, rename, update, delete (`/account/designs`); ownership enforced in SQL; limit of 50 per customer.
- Admin **3D assets** area: product list with model status, upload / replace / remove a model, model details (triangles, textures, nodes, materials), choose which materials customers may change, style-option editor with live preview, test colour.
- Backend module `garments`: model inspection (GLB/glTF structure, size, unsupported extensions, external references), private storage, authorised streaming, options and designs APIs.
- Migration `004_create_garment_studio.sql`: `garment_assets`, `customization_options`, `customization_values`, `garment_customizations`.
- Product detail page: working "Customize in 3D" link when a model exists, honest unavailable state otherwise; products API now returns `has3dModel`.
- Sample blocky test model (`docs/sample-assets/sample-tee-blocky.glb`) and generator script (`npm run sample:garment`).
- Tests: `tests/garments.logic.test.js` (11 tests), `tests/garments.routes.test.js` (auth guards).

### Changed
- `middleware/upload.js`: added private model upload (existing image upload unchanged).
- `products.service.js`: product detail includes `has3dModel`; deleting a product also deletes its stored model file.
- `config/env.js`, `.env.example`: `MAX_MODEL_MB`, private upload directory.
- App routes, account and admin navigation extended. The three.js code is lazy-loaded so the storefront bundle does not grow.

### Dependencies
- Web: `three`, `@react-three/fiber`, `@react-three/drei`. API: none.

### Breaking changes
None. `package-lock.json` will change when you run `npm install`.

## [0.1.0] - Phase 1: Foundation and Core Application

### Added
- Monorepo (`apps/api`, `apps/web`) in JavaScript only.
- Express API: auth (register/login/me), profile + password change, products (public + admin CRUD), categories (public + admin CRUD), wishlist, admin stats/inventory/customers/settings, secure admin image upload, health check.
- MySQL 8 schema via SQL migrations with a checksum-tracked runner; idempotent seed script reading accounts only from `SEED_*` env vars.
- React storefront: home, shop (search, category filter, sort, pagination), product detail, login, register, about, contact.
- Customer area: overview, profile, wishlist, orders (empty state), settings (password).
- Admin dashboard: overview, products (create/edit/delete with confirmation, images, variants), categories, inventory, customers, store settings; responsive sidebar.
- Security: bcrypt hashing, JWT (HS256), role checks, Zod validation, parameterized SQL, helmet, CORS, auth rate limiting, upload type/size/signature checks.
- API tests (Node test runner) for validation and auth guards.

### Breaking changes
None (initial release).
