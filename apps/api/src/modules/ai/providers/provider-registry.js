import { createChatProvider, listChatProviderIds } from './chat/chat-provider.factory.js';
import { createImageProvider, listImageProviderIds } from './image/image-provider.factory.js';
import { listTryOnProviderIds } from './tryon/tryon-provider.factory.js';

/**
 * Provider registry: builds the selected provider for each AI capability ONCE, at startup, from environment
 * configuration. The three capabilities are independent: changing CHAT_AI_PROVIDER cannot affect IMAGE_EDIT_PROVIDER
 * or TRYON_PROVIDER. There is never a fallback to another provider (no silent switching, no silent spending).
 * Changing `.env` requires a backend restart (providers are not hot-swapped at runtime).
 *
 * @param {object} p
 * @param {{chatProvider:string, imageProvider:string}} p.aiConfig  selection (env.ai)
 * @param {Record<string,string|undefined>} p.envVars               process.env (adapters read their own variables)
 * @param {any} p.tryon                                             the Phase 3 try-on provider instance (already built)
 * @param {{tryonProviderName:string}} p.names
 * @param {object} [p.deps]                                         e.g. { fetchImpl } for tests
 */
export function createProviderRegistry({ aiConfig, envVars, tryon, tryonProviderName, deps }) {
  const issues = [];
  const slots = { chat: null, image: null, tryon };

  const build = (key, name, factory) => {
    try {
      slots[key] = factory(name, envVars, deps);
    } catch (err) {
      issues.push({ capability: key, level: 'error', message: err.message });
    }
  };
  build('chat', aiConfig.chatProvider, createChatProvider);
  build('image', aiConfig.imageProvider, createImageProvider);

  for (const key of ['chat', 'image', 'tryon']) {
    const issue = slots[key]?.configIssue?.();
    if (issue) issues.push({ capability: key, level: 'warn', message: issue });
  }
  if (tryon && !listTryOnProviderIds().includes(tryonProviderName)) {
    issues.push({ capability: 'tryon', level: 'error', message: `Unknown TRYON_PROVIDER "${tryonProviderName}". Implemented try-on providers: ${listTryOnProviderIds().join(', ')}` });
  }

  const ready = (key) => !!slots[key] && slots[key].isConfigured();
  return {
    chat: slots.chat,
    image: slots.image,
    tryon: slots.tryon,
    issues,
    /** Configuration errors that must stop the server (unknown provider names). Missing keys are only warnings. */
    fatalIssues: () => issues.filter((i) => i.level === 'error' && i.capability !== 'tryon'),
    isReady: ready,
    /** Safe summary for status endpoints and logs: never contains keys. */
    summary: () => Object.fromEntries(['chat', 'image', 'tryon'].map((k) => {
      const d = slots[k]?.describe?.();
      return [k, { provider: slots[k]?.id ?? null, label: d?.label ?? null, model: d?.model ?? null, configured: ready(k), issue: slots[k]?.configIssue?.() ?? null }];
    })),
    supported: () => ({ chat: listChatProviderIds(), image: listImageProviderIds(), tryon: listTryOnProviderIds() }),
  };
}
