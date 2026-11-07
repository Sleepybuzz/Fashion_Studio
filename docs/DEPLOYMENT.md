# Deployment 
Recommended: one Linux VPS with nginx, Node 20+, MySQL 8, pm2, and Let's Encrypt. The API serves private files itself, so a static-only host is not enough.

1. DNS: point an A record for your domain at the server.
2. `git clone`, then `npm ci`.
3. `apps/api/.env`: copy from `.env.example`; set `NODE_ENV=production`, `FRONTEND_URL=https://your.domain`, `TRUST_PROXY=1`, a random `JWT_SECRET`, DB creds, provider keys. Leave `SEED_*` blank except for one-time admin creation, then blank them again.
4. MySQL: create DB/user, then `npm run migrate`. Back up with `mysqldump` before each later migration.
5. Web: set `VITE_API_URL=https://your.domain` in `apps/web/.env`, run `npm run build:web`, copy `apps/web/dist` to the nginx root.
6. nginx: adapt `deploy/nginx.conf.example`; `certbot --nginx` for HTTPS (required for camera/AR).
7. API: `pm2 start deploy/ecosystem.config.cjs`; check `https://your.domain/api/health`.
Uploads live in `apps/api/uploads/private`; include them in backups and note they contain customer photos.
