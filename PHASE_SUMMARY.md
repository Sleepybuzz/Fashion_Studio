# Phase 1 Summary: Foundation and Core Application

## Objectives
Single-vendor store foundation: project setup, database, authentication, storefront, customer area, admin product management.

## Implemented (code written)
Everything listed in CHANGELOG 0.1.0. Roles: `admin`, `customer` only. No brand/vendor code.

## Verification status
**Executed in the build environment**
- `npm install` for all workspaces: succeeded.
- `npm test` (API): 8/8 passing. Covers slugify, register/product Zod schemas, rejection of `javascript:` image URLs, 401 on protected and admin routes (including upload), 400 field errors on bad login, 404 JSON.
- `npm run build:web` (Vite production build): succeeded.

**NOT executed (no MySQL server was available in the build environment) — please verify locally**
- Running migrations and seed against MySQL 8.
- Register/login, profile update, wishlist against a real database.
- Admin product/category CRUD, inventory, settings, image upload end to end.
- Visual/responsive review at the listed viewport widths. Layouts were written mobile-first (responsive grids, collapsible nav and admin sidebar, scrollable tables) but have **not** been viewed in a browser.

Because the database paths are untested, expect the possibility of small SQL or integration bugs on first run; report any error output and they can be fixed.

## Dependencies
API: express, cors, helmet, express-rate-limit, mysql2, jsonwebtoken, bcryptjs, zod, multer, dotenv.
Web: react, react-dom, react-router-dom, @tanstack/react-query, zustand, axios, lucide-react; dev: vite, @vitejs/plugin-react, tailwindcss, postcss, autoprefixer.

## Environment, migrations, API
See README.md (all variables, migration order, endpoint table).

## Known limitations
Cart/checkout/payments/orders not implemented; 3D studio entry disabled; JWT in localStorage; public product-image path; addresses table has no UI yet; admin cannot yet disable customers from the UI.

## Next phase (Phase 2) requirements
Upload the combined project ZIP (without `node_modules`, `dist` or `.env`) after you have applied and tested Phase 1. Phase 2 has **not** been started.

# Phase 2 Summary: 3D Garment Studio and Customization

## Objectives
Let customers view supported products in 3D and customize them; let the store owner manage 3D assets; save and reopen customer designs. Single-vendor model unchanged; JavaScript only.

## Implemented (code written)
- 3D viewer, customization panel, studio page, saved designs, admin 3D assets, backend `garments` module, migration 004. Details in CHANGELOG 0.2.0 and README ("3D Garment Studio").
- Style options are node show/hide inside one GLB (a technically valid approach that needs the model to contain every variant). Colour/material are PBR parameter changes on admin-selected materials.

## Verification status
**Executed in the build environment**
- `node --test tests/garments.logic.test.js`: **11/11 passing**. Covers GLB inspection (valid sample, bad header, truncated, wrong version, Draco/KTX2/unknown extensions, external buffers/textures, self-contained .gltf, invalid JSON), node-name sanitising, saved-design validation, presets, Zod schemas.
- Syntax/JSX parse check (esbuild transform) of **every** `.js` and `.jsx` file in `apps/api` and `apps/web`: no errors. This checks syntax only, not imports or runtime behaviour.

**NOT executed: please verify locally** (the build environment had no network or MySQL, so dependencies could not be installed)
- `npm install`, `npm run build:web`, `npm test` (the existing Phase 1 tests and the new `garments.routes.test.js`, which needs Express installed).
- Migration 004 and every SQL query against MySQL 8.
- The 3D viewer in a browser: model loading, mouse/touch/pinch, zoom/reset/auto-rotate buttons, colour/material/option changes, WebGL-lost handling, rendering quality and exact colours.
- Admin upload / replace / remove and preview end to end; saving, reopening, renaming and deleting designs; ownership checks with two customer accounts.
- Responsive review at the viewport list in the master prompt (layouts are mobile-first but have not been viewed).
- Behaviour with real CLO3D/Blender exports (rigged meshes, large textures).
Expect the possibility of small integration bugs on first run; send the error output and they can be fixed.

## Dependencies
Added (web): `three@^0.169.0`, `@react-three/fiber@^8.17.10` (React 18 compatible), `@react-three/drei@^9.114.3`. None removed. API: none. Install: `npm install` from the project root.

## Environment variables
New, optional: `MAX_MODEL_MB` (default 25) in `apps/api/.env`. Models are stored in `UPLOAD_DIR/private/garments` (git-ignored, never served statically). No new web variables.

## Database
New migration `004_create_garment_studio.sql` (additive; no existing table touched). Run `npm run migrate`. No seed changes.

## API
See README endpoint table. New: `/api/garments/*` (public), `/api/customizations/*` (customer role), `/api/admin/garments/*` (admin). Modified: product detail responses include `has3dModel`.

## Security notes
Admin-only upload/replace/remove; extension, MIME and size checks plus structural validation of the file; random server-side file names; private storage; models served only for active products (admin preview via authenticated route); `nosniff`; saved designs filtered by `user_id` in SQL (other users' ids return 404); configurations validated server-side against real options and presets.

## Known limitations
- GLB is a 3D model, not a CLO3D pattern; no cloth simulation or fabric physics. Material presets are approximations.
- Style options cannot change geometry; they toggle parts already in the file. Node names must be unique and named in the 3D tool.
- Colour tints existing textures. Sheen only on materials with the glTF sheen extension. Unlit materials are not editable.
- Draco and KTX2 compressed files are rejected. `.gltf` must be self-contained. Tune very heavy models (the admin screen warns above 300k triangles).
- One model per product. Replacing a model keeps customizable materials that still exist and warns about options whose nodes vanished.
- Guest choices survive login only within the same browser session (sessionStorage).
- Public model URLs of active products are fetchable without login (needed for the storefront viewer); they are not directory-listable.
- Rate limiting of public asset requests, cart/checkout and later-phase features are not part of this phase.

## Next phase (Phase 3) requirements
Apply and test Phase 2, then upload a fresh combined ZIP of the whole project (without `node_modules`, `dist`, `.env`). Phase 3 has **not** been started.

# Phase 3 Summary: AI Photo Virtual Try-On

## Objectives
Let customers upload a photo, pick an eligible product, and receive a genuinely AI-generated image of themselves wearing it; view/compare, save and delete results. Genlook is the first provider behind a provider-independent architecture. Single-vendor model unchanged; JavaScript only. Phase 4 (AR) not started.

## Implemented (code written)
Everything in CHANGELOG 0.3.0. Key design decisions:
- **Genlook API used as documented** (base `https://api.genlook.app/tryon/v1`, `x-api-key`): `POST /images/upload` -> `POST /try-on` -> `GET /generations/:id`; `DELETE /customers/:id`; `GET /account/credits`. Garment photos are sent as multipart bytes, so they never need public URLs.
- **No automatic retry of the paid call.** Only free calls (upload, status, delete) retry on network/5xx errors. A product is referenced by id first and re-sent inline only on `PRODUCT_NOT_FOUND` (which creates nothing). Customers can manually retry transient failures (max 3 attempts per try-on; Genlook refunds failed generations).
- **Duplicate/cost protection:** one active try-on per customer (enforced in SQL with a row lock), hourly rate limit, per-customer and store-wide daily caps, local timeout so stuck jobs cannot block anyone.
- **Privacy:** consent before upload (versioned, provider-specific text, stored with each try-on); private storage; signed short-lived image URLs; no admin access to customer photos; browser removes metadata; retention + cleanup; delete one/all, plus provider erase on delete-all.
- **No simulation:** with no key (or an unknown provider) the feature reports "unavailable"; test mode is Genlook's own documented mock and is labelled everywhere.

## Verification status
**Executed in the build environment**
- 34 backend tests pass: image header parsing (JPEG incl. EXIF rotation, PNG, WebP lossless/extended; rejection of wrong type/tiny/huge/corrupt), signed-URL signing/expiry/tamper checks, private storage and path-traversal rejection, SSRF guard for result URLs, Genlook adapter against a **fake** `fetch` (request shapes, headers, reference-then-inline flow, no retry of paid call, error normalization, no key leakage, status mapping), and 16 service tests with in-memory fakes (consent, unconfigured provider, ineligible product, happy path, polling throttle/dedupe, duplicate request, provider failures, retries and cap, timeout, ownership, save/delete, delete-all, daily limits, retention cleanup). Plus 2 web helper tests.
- `node --check` of every JS file; esbuild bundling of API entry points and the whole web app (all imports/exports resolve).

**NOT executed - please verify locally**
- `npm install` / `npm run build:web`: the build environment had no npm registry access, so Vite was **not** run. Phase 2 tests (`garments.*`) and `tryon.routes.test.js` need installed packages (`zod`, `express`) and were not run here.
- Migration 005 and every SQL query against MySQL 8 (no MySQL available). Includes the row-lock exclusivity logic.
- **The real Genlook API.** No API key was available. The adapter follows the official docs but has never talked to Genlook; in particular the mixed multipart request (person by `id` plus product images by `fileKey`) and result quality/alignment with `crop=false` are unverified. Use `GENLOOK_TEST_MODE=true` first, then one real try-on.
- Browser behaviour: file picker/camera, canvas resize, iOS/Android, slider touch dragging, responsive layout at the 15 required widths (layouts are mobile-first but have not been viewed in a browser), accessibility checks.
- Admin and customer flows end to end, retention timer, `npm run tryon:cleanup`.

## Dependencies
None added or removed.

## Environment, migrations, API
See README.md (variables, endpoint table) and `apps/api/.env.example`. Migration: `npm run migrate` (applies `005_create_virtual_tryon.sql`).

## Known limitations
- **Quality is the provider's:** results are AI approximations (fit, drape and size are not guaranteed); photos of poor quality or heavy layers can fail or look wrong.
- **No cancel:** Genlook has no cancel endpoint; the UI does not offer one. A try-on abandoned mid-way may still consume a credit.
- **No per-image provider delete:** only erase-by-user (used by *Delete everything*) or automatic expiry (`GENLOOK_KEEP_DAYS`).
- **Timeouts:** if we time out locally (default 240 s) but Genlook finishes later, a credit may be used without a stored result.
- Status is refreshed on demand when the browser polls; if nobody polls, a finished job is collected next time the customer opens it (it must still be within Genlook's retention and our timeout window).
- Single-server design: locks/dedupe are in-process plus MySQL; running several API instances is fine for the SQL rules, but the in-memory poll de-duplication is per instance.
- Garment images are not auto-checked for suitability (e.g. a 3D render or a photo with several garments); admin guidance is shown in the UI. Customer photo content (one person, body visible) is not machine-checked.
- Orphan files (e.g. a crash between writing a file and its database row) are not swept automatically.
- Camera capture uses the device's native camera via the file input; there is no in-page camera (Phase 4).
- Genlook-supplied sub-processors/regions are summarised in the consent text from their public policy; you must review their DPA/terms for your jurisdiction.

## Next phase (Phase 4) requirements
Apply and test Phase 3 (with test mode, then one real try-on), confirm, then upload the full combined project ZIP (no `node_modules`, `dist`, `.env`, `uploads` contents) and request Phase 4. Phase 4 has **not** been started.
