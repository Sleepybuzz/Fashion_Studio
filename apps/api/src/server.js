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
app.listen(env.port, () => {
  console.log(`[api] listening on http://localhost:${env.port} (${env.nodeEnv})`);
});
