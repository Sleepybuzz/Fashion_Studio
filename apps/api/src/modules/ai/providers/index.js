import { env } from '../../../config/env.js';
import { provider as tryonProvider } from '../../tryon/tryon.index.js';
import { createProviderRegistry } from './provider-registry.js';

/**
 * The single, startup-initialized registry of the three AI capabilities (chat, image editing, try-on).
 * Application code asks this registry for a provider; it never imports an adapter directly.
 */
export const providers = createProviderRegistry({
  aiConfig: env.ai,
  envVars: process.env,
  tryon: tryonProvider,
  tryonProviderName: env.tryon.provider,
});

/** Print provider status at startup. Never prints keys. Throws for configuration errors that must stop the server. */
export function reportAiConfig(log = console) {
  for (const i of providers.issues) {
    (i.level === 'error' ? log.error : log.warn)(`[ai] ${i.capability}: ${i.message}${i.level === 'warn' ? ' (this capability is DISABLED until fixed; no simulated results are shown)' : ''}`);
  }
  const s = providers.summary();
  for (const [k, v] of Object.entries(s)) {
    if (v.configured) log.log(`[ai] ${k}: provider "${v.provider}"${v.model ? ` (model ${v.model})` : ''} is configured.`);
  }
  const fatal = providers.fatalIssues();
  if (fatal.length) throw new Error(fatal.map((f) => f.message).join(' '));
}
