# Development Progress

## Status
- Overall: Phase 2 delivered, pending owner testing.
- Completed phases (owner-confirmed): none confirmed yet. Phase 1 was delivered earlier; Phase 2 was built on the uploaded Phase 1 project.
- Current phase: 2 of 7. Phases 3–7 not started.

## Structure
See README.md. New in Phase 2: `apps/api/src/modules/garments/`, `apps/web/src/features/garment-studio/`, `apps/web/src/features/admin/AdminGarments.jsx`, `apps/web/src/features/account/SavedDesignsPage.jsx`, `docs/sample-assets/`.

## Files
**Added (Phase 2):** `database/migrations/004_create_garment_studio.sql`; `apps/api/src/modules/garments/{garments.routes,garments.service,garments.schemas,garments.config,garments.presets,glb}.js`; `apps/api/scripts/generate-sample-garment.js`, `apps/api/scripts/lib/sampleGarment.js`; `apps/api/tests/garments.logic.test.js`, `garments.routes.test.js`; `apps/web/src/services/garment.service.js`; `apps/web/src/features/garment-studio/{GarmentViewer,GarmentStudioPage,CustomizationPanel}.jsx`, `studioUtils.js`; `apps/web/src/features/admin/AdminGarments.jsx`; `apps/web/src/features/account/SavedDesignsPage.jsx`; `docs/sample-assets/sample-tee-blocky.glb`.
**Modified:** `package.json`, `apps/api/package.json`, `apps/web/package.json`, `apps/api/.env.example`, `apps/api/src/{app.js,config/env.js,middleware/upload.js,modules/products/products.service.js}`, `apps/web/src/{app/App.jsx,layouts/AccountLayout.jsx,layouts/AdminLayout.jsx,features/products/ProductDetailPage.jsx}`, README.md, CHANGELOG.md, PHASE_SUMMARY.md, DEVELOPMENT_PROGRESS.md.
**Deleted:** none.

## Dependencies
Phase 1 set plus web: three, @react-three/fiber, @react-three/drei.

## Database migrations
001 users/addresses, 002 catalogue, 003 wishlist/settings, 004 garment studio. Run with `npm run migrate`.

## APIs
See README.md.

## Environment variables
See README.md and `apps/api/.env.example` (new: `MAX_MODEL_MB`).

## Tests performed
Executed: 11 garment logic tests (pass); esbuild syntax parse of all JS/JSX (pass).
Not executed: dependency install, Vite build, Phase 1 + new route tests, MySQL migration/queries, browser/3D/touch/responsive testing, upload end to end. Details in PHASE_SUMMARY.md.

## Known issues / pending
- Everything under "Not executed" is unverified.
- `package-lock.json` is not updated (npm will update it on install).
- Cart, checkout, payments, orders, addresses UI, customer deactivation UI: later phases.

## Requirements for next phase
Apply and test Phase 2, confirm, then upload the full combined project ZIP (no `node_modules`, `dist`, `.env`) and request Phase 3.
