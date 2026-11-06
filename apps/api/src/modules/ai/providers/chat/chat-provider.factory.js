import { assertChatProvider } from './chat-provider.contract.js';
import * as gemini from './gemini.adapter.js';

/**
 * Chat adapters. To add a provider (e.g. OpenAI): write `openai.adapter.js` that exports `ID`, `configFromEnv(env)` and
 * `createOpenaiAdapter(cfg, deps)` returning an object that satisfies chat-provider.contract.js, then add ONE line here.
 * Select it with CHAT_AI_PROVIDER=openai. No route, service, frontend or database change is needed.
 */
const ADAPTERS = {
  [gemini.ID]: { configFromEnv: gemini.configFromEnv, create: gemini.createGeminiAdapter },
};

export const listChatProviderIds = () => Object.keys(ADAPTERS);

/**
 * @param {string} name value of CHAT_AI_PROVIDER
 * @param {Record<string,string|undefined>} envVars
 * @param {object} [deps] e.g. { fetchImpl }
 * @throws {Error} with a clear message for an unknown provider name
 */
export function createChatProvider(name, envVars, deps) {
  const entry = ADAPTERS[name];
  if (!entry) throw new Error(`Unknown CHAT_AI_PROVIDER "${name}". Implemented chat providers: ${listChatProviderIds().join(', ')}`);
  return assertChatProvider(entry.create(entry.configFromEnv(envVars), deps));
}
