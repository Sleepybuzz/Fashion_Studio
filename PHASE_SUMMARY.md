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
