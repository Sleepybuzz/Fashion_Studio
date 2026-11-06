# Development Progress

## Status
- Overall: Phase 4 delivered, pending owner testing (especially on real devices).
- Completed phases (owner-confirmed): none confirmed yet. Phases 1-3 were delivered earlier; Phase 4 was built on the uploaded Phase 1+2+3 project.
- Current phase: 4 of 7. Phases 5-7 not started.

## Structure
See README.md. New in Phase 4: `apps/api/src/modules/ar/` (constants, alpha, schemas, service, index, routes), `apps/web/src/features/ar-tryon/` (page, workspace, scene, customize panel, capture preview, `arMath`, `cameraUtils`, `useCamera`, `usePoseTracking`, `poseTracker`, `captureUtils`, tests), `apps/web/src/features/account/MyArCapturesPage.jsx`, `apps/web/src/features/admin/AdminAr.jsx`, `apps/web/src/services/ar.service.js`, `apps/web/scripts/setup-mediapipe.mjs`, `database/migrations/006_create_ar_tryon.sql`.

## Files (Phase 4)
**Added:** migration 006; `apps/api/src/modules/ar/{ar.constants,ar.alpha,ar.schemas,ar.service,ar.index,ar.routes}.js`; `apps/api/tests/{ar.unit.test.js,ar.integration.test.js,helpers/images.js}`; `apps/web/src/features/ar-tryon/{ArTryOnPage,ArWorkspace,ArScene,ArCustomizePanel,CapturePreview}.jsx`, `{arMath,cameraUtils,useCamera,usePoseTracking,poseTracker,captureUtils}.js`, `{arMath,cameraUtils}.test.mjs`; `features/account/MyArCapturesPage.jsx`; `features/admin/AdminAr.jsx`; `services/ar.service.js`; `scripts/setup-mediapipe.mjs`.
**Modified:** `package.json`, `package-lock.json`, `apps/api/package.json`, `apps/web/package.json`, `.gitignore`, both `.env.example`; API `app.js`, `server.js`, `config/env.js`, `middleware/upload.js`, `modules/tryon/tryon.storage.js` (optional `kinds` argument), `modules/products/products.service.js`; web `App.jsx`, `AccountLayout.jsx`, `AdminLayout.jsx`, `ProductDetailPage.jsx`, `GarmentViewer.jsx` (exports only); README, CHANGELOG, PHASE_SUMMARY, this file.
**Deleted:** none.

## Dependencies
Added `@mediapipe/tasks-vision@1.2.2` (apps/web). Others unchanged.

## Database migrations
001 users/addresses, 002 catalogue, 003 wishlist/settings, 004 garment studio, 005 virtual try-on, **006 AR try-on** (`product_ar_configs`, `ar_captures`). Run with `npm run migrate`. Verified on MySQL 8.0.46.

## APIs
See README. New: `/api/ar/*` (public product config + overlay, signed screenshot, customer captures) and `/api/admin/ar/*`. `GET /api/products/:slug` adds `arEligible`.

## Environment variables
New (all optional, no API key): MAX_AR_CAPTURE_MB, MAX_AR_OVERLAY_MB, AR_CAPTURE_RETENTION_DAYS, AR_MAX_CAPTURES_PER_USER, AR_CAPTURE_HOURLY_LIMIT, AR_SIGNED_URL_TTL_SECONDS (api); VITE_MEDIAPIPE_WASM_URL, VITE_MEDIAPIPE_MODEL_URL (web).

## Tests performed
Executed: API 78/78 pass with a real MySQL 8 (70 + 8 integration; includes all earlier tests); migrations 001-006 on MySQL 8.0.46; web 20/20; Vite production build; SSR smoke of the customize panel.
Not executed: camera, MediaPipe inference in a browser, WebGL rendering and alignment, screenshot composition, responsive/touch/rotation review, HTTPS, low-end performance, Genlook live. Details in PHASE_SUMMARY.md.

## Known issues / pending
- Everything under "Not executed" is unverified.
- Rigid-overlay limits (no cloth, fit, occlusion; upper-body only) are documented in PHASE_SUMMARY.md.
- Cart, checkout, payments, orders, addresses UI, customer account deletion: later phases. Account deletion must also remove `uploads/private/ar/captures` and `uploads/private/tryon`.

## Requirements for next phase
Apply and test Phase 4 on a phone (HTTPS) and a laptop, confirm, then upload the full combined project ZIP (no `node_modules`, `dist`, `.env`, uploads contents, `apps/web/public/mediapipe`) and request Phase 5 (AI Personal Stylist).
