import { assertServerConfig, env } from './config/env.js';
import { createApp } from './app.js';
import { reportTryOnConfig, startTryOnMaintenance } from './modules/tryon/tryon.index.js';
import { startArMaintenance } from './modules/ar/ar.index.js';
import { reportAiConfig } from './modules/ai/providers/index.js';
import { startAiMaintenance } from './modules/ai/ai.index.js';

try {
  assertServerConfig();
} catch (err) {
  console.error(`\n[config] ${err.message}\nCopy apps/api/.env.example to apps/api/.env and fill it in.\n`);
  process.exit(1);
}

reportTryOnConfig();
try {
  reportAiConfig();
} catch (err) {
  console.error(`\n[config] ${err.message}\nFix CHAT_AI_PROVIDER / IMAGE_EDIT_PROVIDER in apps/api/.env (see apps/api/.env.example).\n`);
  process.exit(1);
}
startTryOnMaintenance();
startArMaintenance();
startAiMaintenance();

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`[api] listening on http://localhost:${env.port} (${env.nodeEnv})`);
});
// Long enough for AI generations (the services enforce their own, shorter, timeouts).
server.requestTimeout = env.requestTimeoutMs;
server.keepAliveTimeout = 65_000;

// Graceful shutdown for process managers (pm2, systemd, Docker): stop accepting requests, then close the DB pool.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[api] ${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close(async () => {
    try { await (await import('./config/db.js')).pool.end(); } catch { /* ignore */ }
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('[api] unhandledRejection:', reason instanceof Error ? reason.message : String(reason));
});
