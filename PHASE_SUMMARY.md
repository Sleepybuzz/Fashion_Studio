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
