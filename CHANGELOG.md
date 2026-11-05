# Changelog

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
