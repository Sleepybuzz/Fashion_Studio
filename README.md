# AI Fashion Studio

A **single-vendor** clothing store (one Store Owner/Admin, many Customers). Current state: **Phase 2: 3D Garment Studio** on top of the Phase 1 foundation. AI try-on, AR, AI stylist, cart, checkout and payments are **not** built yet.

## Stack

| Area | Technology |
|---|---|
| Web | React 18, Vite 5, Tailwind CSS 3, React Router 6, Zustand, TanStack Query 5, Axios, Lucide React, three.js + React Three Fiber + Drei (JavaScript only, `.jsx`) |
| API | Node 20+, Express 4, ES Modules, mysql2/promise, JWT (jsonwebtoken), bcryptjs, Zod, helmet, cors, multer |
| Database | MySQL 8, plain SQL migrations |

## Structure

```
AI-Fashion-Studio/
├── apps/
│   ├── api/   (src/config, middleware, modules/{auth,users,products,categories,wishlist,admin,garments}, scripts/, tests/, uploads/)
│   └── web/   (src/app, components, layouts, features/{auth,products,garment-studio,account,admin,pages}, hooks, services, stores, utils)
├── database/migrations/   (001..004 .sql)
├── packages/shared/       (reserved, empty)
├── docs/                  (sample-assets/sample-tee-blocky.glb: blocky test model)
└── CHANGELOG.md, PHASE_SUMMARY.md, DEVELOPMENT_PROGRESS.md
```

## Setup (Windows PowerShell, from the project root)

Requirements: Node.js 20+ and MySQL 8 running locally.

```powershell
# 1. Install dependencies for all workspaces
npm install

# 2. Create your local env files
Copy-Item apps\api\.env.example apps\api\.env
Copy-Item apps\web\.env.example apps\web\.env

# 3. Generate a JWT secret and paste it into apps\api\.env as JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Edit `apps\api\.env` in VS Code: set `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, and choose your own `SEED_*` email/password values (they are never stored in the repo).

```powershell
# 4. Create the database and tables (safe to re-run; never drops anything)
npm run migrate

# 5. Seed categories, sample products (dev only) and the accounts from SEED_* variables
npm run seed

# 6. Run (two terminals)
npm run dev:api     # http://localhost:5000
npm run dev:web     # http://localhost:5173
```

Other commands: `npm test` (API tests, no database needed), `npm run build:web`.

## Environment variables (`apps/api/.env`)

| Variable | Required | Purpose |
|---|---|---|
| NODE_ENV | no | `development` (default) or `production` |
| PORT | no | API port (default 5000) |
| FRONTEND_URL | no | Allowed CORS origin (default http://localhost:5173) |
| DB_HOST, DB_PORT | no | MySQL host/port (localhost, 3306) |
| DB_USER, DB_PASSWORD | **DB_USER required** | MySQL credentials |
| DB_NAME | no | Database name (default `ai_fashion_studio`) |
| JWT_SECRET | **required** | 32+ chars; server refuses to start otherwise |
| JWT_EXPIRES_IN | no | Token lifetime (default 7d) |
| STORAGE_DRIVER | no | `local` only for now |
| UPLOAD_DIR | no | Upload folder relative to `apps/api` (default `uploads`) |
| MAX_UPLOAD_MB | no | Max image size (default 5) |
| MAX_MODEL_MB | no | Max 3D model (.glb/.gltf) size in MB (default 25). Models are stored privately in `UPLOAD_DIR/private/garments` |
| SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD | optional | Admin account created by `npm run seed` |
| SEED_CUSTOMER_EMAIL / SEED_CUSTOMER_PASSWORD | optional | Sample customer account |

`apps/web/.env`: `VITE_API_URL` (default http://localhost:5000).

If seed variables are blank, account seeding is skipped with a message.

### Production admin provisioning

Do not use development seed values in production. Set `NODE_ENV=production`, provide a unique `SEED_ADMIN_EMAIL` and a strong `SEED_ADMIN_PASSWORD` (12+ chars) only for the one-time `npm run seed`, then remove them from the environment. In production the seed skips sample products and rejects short passwords. The admin can then change the password in the app. Public registration only ever creates `customer` accounts.

## API (base `/api`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | /health | – | API + DB status |
| POST | /auth/register | – | Creates a customer, returns `{user, token}` |
| POST | /auth/login | – | Returns `{user, token}` (rate-limited) |
| GET | /auth/me | user | Current user |
| GET / PATCH | /users/me | user | Read / update profile |
| PUT | /users/me/password | user | Change password |
| GET | /products | – | Query: `q, category, sort, featured, page, limit` (active only) |
| GET | /products/:slug | – | Product with images and variants |
| GET | /categories | – | Categories with active product counts |
| GET | /store-info | – | Public store name/contact/currency |
| GET | /wishlist, /wishlist/ids | user | |
| PUT / DELETE | /wishlist/:productId | user | Add / remove |
| GET | /admin/stats, /admin/inventory, /admin/customers | admin | |
| GET / PUT | /admin/settings | admin | Store settings |
| GET / POST | /admin/products | admin | List (any status) / create |
| GET / PUT / DELETE | /admin/products/:id | admin | |
| GET / POST | /admin/categories | admin | |
| PUT / DELETE | /admin/categories/:id | admin | |
| POST | /admin/uploads/product-image | admin | multipart field `image`; JPEG/PNG/WebP, size-limited, signature-checked; returns `{url}` |
| GET | /garments/studio/:slug | – | Studio data for an active product: model URL, style options, colour/material presets. 404 if no model |
| GET | /garments/assets/:id/file | – | Streams the model file, only for **active** products (private storage, `nosniff`) |
| GET / POST | /customizations | customer | List own saved designs / save a design |
| GET / PUT / DELETE | /customizations/:id | customer | Own designs only (others return 404) |
| GET | /admin/garments | admin | Every product with 3D model status |
| GET | /admin/garments/product/:productId | admin | Product + model details + style options |
| PUT | /admin/garments/product/:productId/model | admin | multipart field `model` (.glb/.gltf): upload or replace; content is validated |
| PATCH | /admin/garments/product/:productId/model | admin | `{customizableMaterials: string[]}` |
| DELETE | /admin/garments/product/:productId/model | admin | Remove model + style options (saved designs are kept) |
| GET | /admin/garments/product/:productId/model/file | admin | Authenticated preview download (any product status) |
| PUT | /admin/garments/product/:productId/options | admin | Replace the product's style options |

Errors: `{ "error": { "message", "details?" } }`.

## Database

Migrations run in filename order and are recorded in `schema_migrations`:
`001_create_users_and_addresses.sql`, `002_create_catalogue.sql` (categories, products, images, variants), `003_create_wishlist_and_settings.sql`, `004_create_garment_studio.sql` (garment_assets, customization_options, customization_values, garment_customizations). There are no brand/vendor tables. The `addresses` table is created now but has no UI/API yet.

## 3D Garment Studio (Phase 2)

**Customers:** open a product with a 3D model and choose *Customize in 3D* (`/studio/:slug`). Rotate, zoom and pan the garment; pick a colour, a material finish and any style options; log in to save designs (`/account/designs`).

**Store owner:** *Admin → 3D assets*. Pick a product, upload a `.glb` (recommended) or self-contained `.gltf`, tick which model materials customers may recolour, and optionally define style options (see below).

Try it without a real model: `npm run sample:garment` writes `docs/sample-assets/sample-tee-blocky.glb` (a blocky test asset, also included). Its nodes are `Body_Regular`, `Body_Cropped`, `Sleeve_Short_L/R`, `Sleeve_Long_L/R`, `Collar_Crew`, `Collar_Wide`; materials `Fabric` and `Trim`. Example options: Sleeves (Short: show `Sleeve_Short_L, Sleeve_Short_R`, hide `Sleeve_Long_L, Sleeve_Long_R`; Long: the reverse), Length, Neckline.

How customization works (honest scope):
- **Colour / material** change the PBR parameters (colour, roughness, metalness, and sheen where the model supports it) of the materials the store selected. Colour tints existing textures.
- **Style options** only show/hide named nodes that already exist in the same model file. They cannot reshape the garment. A different cut needs a model that contains it.
- A GLB is a 3D model, **not** a CLO3D sewing pattern. There is no cloth or drape simulation.
- Draco and KTX2 compressed models are rejected with a clear message (their decoders would be downloaded from a CDN). Meshopt is supported.
- Lighting is procedural (no external HDR download). The viewer uses on-demand rendering to save battery.

## Known limitations

- Add to cart, checkout, payments and orders are not implemented (UI is clearly disabled; order history is an honest empty state).
- Phase 2 limits: see the 3D Garment Studio section above and PHASE_SUMMARY.md.
- JWT is stored in `localStorage` (documented trade-off).
- Product images are served publicly from `/uploads/products` (intended for catalogue images). 3D models use the separate private path described above; customer photos (Phase 3) must do the same.
- Product search uses `LIKE`.
