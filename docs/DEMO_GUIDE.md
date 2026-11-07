# Demo guide
Create accounts by setting `SEED_ADMIN_*` / `SEED_CUSTOMER_*` in `apps/api/.env`, then `npm run seed`. Routes: `/shop`, `/shop/:slug`, `/studio/:slug` (3D), `/customize/product/:slug` and `/customize/upload` (AI), `/try-on/:slug` (photo), `/ar-try-on/:slug` (AR), `/account/*`, `/admin/*`.
Limits: no cart/checkout/orders (intentionally skipped); AR is a rigid upper-body overlay; AI features need provider keys and may cost money.
Troubleshooting: API won't start → read the `[config]` message; blank AR → HTTPS + camera permission; 429 → rate limit.
