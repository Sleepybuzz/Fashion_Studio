import { assertServerConfig, env } from './config/env.js';
import { createApp } from './app.js';

try {
  assertServerConfig();
} catch (err) {
  console.error(`\n[config] ${err.message}\nCopy apps/api/.env.example to apps/api/.env and fill it in.\n`);
  process.exit(1);
}

const app = createApp();
app.listen(env.port, () => {
  console.log(`[api] listening on http://localhost:${env.port} (${env.nodeEnv})`);
});
