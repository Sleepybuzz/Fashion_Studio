# Changelog

## [0.5.0] - Phase 5: AI Chat Customization

### Added
- "AI Chat & Customize This Product" (product page, `/customize/product/:slug`) and upload-and-customize (`/customize/upload`); chat session page with preview, compare with original, version history, restore, delete, save, and a try-on methods panel; `/account/ai-designs`.
- Provider architecture: `CHAT_AI_PROVIDER` (Gemini), `IMAGE_EDIT_PROVIDER` (Cloudflare FLUX.1 Kontext Pro), `TRYON_PROVIDER` (Genlook, reused). Contracts, factories, registry, normalized errors, no fallback.
- Backend module `ai`: structured-instruction validation against real product options, unseen-view refusal, idempotent messages, one image generation at a time, limits, private signed images, retention purge, admin aggregate overview.
- Unified try-on eligibility; AI Photo Try-On accepts a generated design (`customizationVersionId`).
- Migration `007_create_ai_customization.sql`.
- Tests: provider, instruction and service unit tests.

### Changed
- Genlook adapter exposes `generateTryOn`/`getTryOnStatus` aliases; `tryon.*` files, `products.service.js` (`aiCustomizeEligible`), `config/env.js`, `app.js`, `server.js`, `middleware/upload.js`, `.env.example`, README, versions 0.5.0.

### Dependencies
None added.

### Breaking changes
None.

## [0.4.0] - Phase 4: Real-Time AR Try-On

### Added
- **Real-Time AR Try-On** (`/ar-try-on/:slug`, lazy-loaded): intro screen explaining privacy and the difference from AI Photo Try-On, explicit **Start camera** step, live camera with a shoulder-anchored garment overlay, tracking status and guidance, front/rear camera switch, "show tracking points" debug toggle, screenshot capture, preview, download, discard or save, exit (Esc / button).
- **Body tracking in the browser** with MediaPipe Pose Landmarker (`@mediapipe/tasks-vision` 1.2.2, GPU then CPU delegate): shoulders, elbows, wrists, hips; confidence/in-frame checks; One-Euro smoothing; 500 ms hold when tracking drops, reset after a longer gap; distance / hips-hidden / shoulders-hidden guidance; adaptive detection rate and a low-performance notice. Camera frames are never sent anywhere.
- **Garment rendering** (three.js / R3F, pixel-space orthographic layer, on-demand rendering): Phase 2 GLB/GLTF models (reusing the Phase 2 model preparation, visibility and colour/material code) and transparent 2D overlays, with garment-type profiles (`top`, `outerwear`) and per-product size / vertical calibration.
- **Customization in AR**: colour, material finish and style options of the Phase 2 studio, reset to original. Controls appear only when the model supports them (no editable material -> no colour controls; image overlays -> none).
- **Saved AR captures**: preview before saving, explicit consent (`ar-v1`), private storage, signed URLs, per-customer limit, retention (default 90 days) with hourly cleanup, delete one/all (`/account/ar-captures`).
- **Admin -> AR try-on** (`/admin/ar`, `/admin/ar/:productId`): enable per product, choose 3D model or 2D overlay, garment type, size/vertical sliders, upload/replace/remove a transparent overlay with a checkerboard preview.
- **Camera robustness**: classified errors (permission denied, no camera, camera busy, insecure context, camera lost, unsupported browser) with recovery steps; tracks stopped on exit, pagehide and errors; WebGL context-loss and asset-load recovery.
- Backend module `ar`: dependency-injected service, routes, Zod schemas, alpha-channel detection for overlays; migration `006_create_ar_tryon.sql` (`product_ar_configs`, `ar_captures`).
- `scripts/setup-mediapipe.mjs` (`npm run setup:ar`): copies wasm and downloads the pose model for self-hosting; app falls back to official public hosts.
- Tests: 11 AR unit tests + 8 integration tests (real MySQL + HTTP) on the API; 18 web tests (tracking maths, coordinate mapping/mirroring, smoothing, placement, camera helpers).

### Changed
- Product page now offers **AI Photo Try-On** and **Real-Time AR Try-On** as two clearly explained options; `GET /products/:slug` returns `arEligible`.
- `GarmentViewer.jsx`: exported `prepareModel`, `applyVisibility`, `applyLook`, `disposeGltf`, `pendingDispose` (no behaviour change) so AR reuses Phase 2 logic instead of duplicating it.
- `tryon.storage.js`: `createTryOnStorage(rootDir, kinds?)` accepts custom folders (default unchanged); `middleware/upload.js`, `config/env.js`, `app.js`, `server.js` (AR upload helpers, env, routes, cleanup timer); `products.service.js` (eligibility flag; deleting a product also deletes its overlay file). Account/admin navigation and routes extended. Versions 0.4.0.

### Dependencies
Added `@mediapipe/tasks-vision@1.2.2` (apps/web). Nothing removed. Note: `@react-three/drei` already bundles its own older copy (0.10.x) in the repo root; the AR code and setup script use the apps/web copy.

### Breaking changes
None. Run `npm install`, `npm run migrate` (applies 006), optionally `npm run setup:ar`.

## [0.3.0] - Phase 3: AI Photo Virtual Try-On

### Added
- **Virtual try-on flow** (`/try-on/:slug`): consent first, then photo selection (drag and drop, file picker, camera on touch devices), client-side resize/EXIF-orientation fix/metadata removal, preview, replace/remove, submit. Result page (`/account/try-ons/:id`) with live progress, original-vs-result slider / side by side / result only, save, download, delete, retry.
- **My try-ons** (`/account/try-ons`): real data from the API, thumbnails, status, expiry, save/unsave, delete one, delete everything.
- **Provider-independent architecture** (`apps/api/src/modules/tryon/providers`): contract + registry; **Genlook adapter** written against the official REST docs (upload, create, status polling, erase-by-user, credits, documented `mock` test flag). Provider errors are normalized; customers only see safe messages.
- **Admin Virtual try-on** area: per-product enable switch, 1-4 private garment photos (add/replace/delete), optional AI fit description, provider status panel, 30-day aggregate usage (no customer images), credit balance check.
- **Backend module `tryon`**: dependency-injected service (consent enforcement, eligibility, image validation by real signature and dimensions, limits, one active try-on per customer, local timeout, on-demand status refresh, private result storage, retention), MySQL repository, signed-URL image streaming, rate limits, maintenance job and `npm run tryon:cleanup`.
- Migration `005_create_virtual_tryon.sql`: `product_tryon_configs`, `product_tryon_images`, `tryon_sessions` (additive; nothing existing is altered).
- Product detail page: "Try it on with AI" button for eligible products (honest unavailable text otherwise); products API returns `tryOnEligible`.
- Tests: 18 + 16 new passing tests (image parsing, signing, storage, Genlook adapter with a fake `fetch`, service state machine); route auth-guard tests added (need `npm install` to run).

### Changed
- `config/env.js`, `.env.example`: Phase 3 variables (see README). `middleware/upload.js`: in-memory validated uploads for try-on photos/garment photos. `app.js`, `server.js`: mount routes, report provider status at startup, start retention timer. `products.service.js`: `tryOnEligible`; deleting a product also deletes its try-on garment files. Account/admin navigation and routes extended. Package versions 0.3.0.

### Dependencies
None added (uses Node 20+ built-in `fetch`, `FormData`, `Blob`; existing multer, express-rate-limit, zod).

### Breaking changes
None. Run `npm run migrate` to apply migration 005.

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
