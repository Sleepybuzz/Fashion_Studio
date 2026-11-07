# AI providers
Selected by env, keys backend-only, no automatic fallback.
- Chat: `CHAT_AI_PROVIDER=gemini` (needs `GEMINI_API_KEY`, `GEMINI_CHAT_MODEL`).
- Image edit: `IMAGE_EDIT_PROVIDER=photoroom|cloudflare`. **The code and `.env.example` default to `photoroom`**; Cloudflare FLUX.1 Kontext Pro is used only if you set `cloudflare` plus `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` (paid per image).
- Try-on: `TRYON_PROVIDER=genlook` (`GENLOOK_API_KEY`).
Model IDs, endpoints and prices were **not** re-verified against official docs in Phase 7 (no network). Limits for cost control are in `.env.example`.
