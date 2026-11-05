# Development Progress

## Status
- Overall: Phase 3 delivered, pending owner testing.
- Completed phases (owner-confirmed): none confirmed yet. Phase 1 and 2 were delivered earlier; Phase 3 was built on the uploaded Phase 1+2 project.
- Current phase: 3 of 7. Phases 4-7 not started.

## Structure
See README.md. New in Phase 3: `apps/api/src/modules/tryon/` (service, repo, catalog, routes, schemas, storage, signing, image inspection, maintenance, `providers/{provider.contract,genlook.provider,index}.js`), `apps/web/src/features/virtual-tryon/`, `apps/web/src/features/account/MyTryOnsPage.jsx`, `apps/web/src/features/admin/AdminTryOn.jsx`, `apps/web/src/services/tryon.service.js`, `database/migrations/005_create_virtual_tryon.sql`.

## Files
**Added (Phase 3):** `database/migrations/005_create_virtual_tryon.sql`; `apps/api/src/modules/tryon/{tryon.constants,image.inspect,signing,tryon.storage,download,tryon.errors,tryon.service,tryon.repo,tryon.catalog,tryon.maintenance,tryon.schemas,tryon.index,tryon.routes}.js`; `apps/api/src/modules/tryon/providers/{provider.contract,genlook.provider,index}.js`; `apps/api/scripts/tryon-cleanup.js`; `apps/api/tests/tryon.{image,signing,genlook,service,routes}.test.js`; `apps/web/src/services/tryon.service.js`; `apps/web/src/features/virtual-tryon/{VirtualTryOnPage,TryOnSessionPage,CompareView,PrivateImage}.jsx`, `photoUtils.js`, `photoUtils.test.mjs`; `apps/web/src/features/account/MyTryOnsPage.jsx`; `apps/web/src/features/admin/AdminTryOn.jsx`.
**Modified:** `package.json`, `apps/api/package.json`, `apps/web/package.json` (version 0.3.0, script `tryon:cleanup`); `apps/api/.env.example`; `apps/api/src/{app.js,server.js,config/env.js,middleware/upload.js,modules/products/products.service.js}`; `apps/web/src/{app/App.jsx,layouts/AccountLayout.jsx,layouts/AdminLayout.jsx,features/products/ProductDetailPage.jsx}`; README.md, CHANGELOG.md, PHASE_SUMMARY.md, DEVELOPMENT_PROGRESS.md.
**Deleted:** none.

## Dependencies
Unchanged (Phase 2 set). Node 20+ built-ins (`fetch`, `FormData`, `Blob`) are used for the provider.

## Database migrations
001 users/addresses, 002 catalogue, 003 wishlist/settings, 004 garment studio, **005 virtual try-on** (`product_tryon_configs`, `product_tryon_images`, `tryon_sessions`). Run with `npm run migrate`.

## APIs
See README.md. New: `/api/tryon/*` (customer + signed assets), `/api/admin/tryon/*` (admin). `GET /api/products/:slug` adds `tryOnEligible`.

## Environment variables
New (all optional except the key for real use): TRYON_PROVIDER, GENLOOK_API_KEY, GENLOOK_API_BASE_URL, GENLOOK_KEEP_DAYS, GENLOOK_TEST_MODE, GENLOOK_CROP_PHOTO, MAX_TRYON_PHOTO_MB, MAX_TRYON_GARMENT_MB, TRYON_USER_HOURLY_LIMIT, TRYON_USER_DAILY_LIMIT, TRYON_STORE_DAILY_CAP, TRYON_TIMEOUT_SECONDS, TRYON_UNSAVED_RETENTION_DAYS, TRYON_SAVED_RETENTION_DAYS, TRYON_SIGNED_URL_TTL_SECONDS.

## Tests performed
Executed: 34 new backend tests pass (image parsing, signing, storage, Genlook adapter with fake fetch, service state machine); 2 web helper tests pass; syntax check and esbuild bundling of API and web (imports resolve).
Not executed: dependency install, Vite build, Phase 2 + route tests (need packages), MySQL migration/queries, **real Genlook API**, browser/camera/touch/responsive testing. Details in PHASE_SUMMARY.md.

## Known issues / pending
- Everything under "Not executed" is unverified.
- `package-lock.json` unchanged (no dependencies added).
- See "Known limitations" in PHASE_SUMMARY.md (no cancel, no per-image provider delete, timeout vs late completion, orphan files).
- Cart, checkout, payments, orders, addresses UI, customer deactivation UI: later phases.
- Deleting a customer account (not implemented in any phase yet) must also remove their files under `uploads/private/tryon`.

## Requirements for next phase
Apply and test Phase 3, confirm, then upload the full combined project ZIP (no `node_modules`, `dist`, `.env`, uploads contents) and request Phase 4 (Real-Time AR Try-On).
