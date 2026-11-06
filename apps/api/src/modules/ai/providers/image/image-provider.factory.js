import { assertImageProvider } from './image-provider.contract.js';
import * as cloudflare from './cloudflare.adapter.js';
import * as photoroom from './photoroom.adapter.js';

/**
 * Image-editing adapters. To add a provider (e.g. Hugging Face): write `huggingface.adapter.js` exporting `ID`,
 * `configFromEnv(env)` and `createHuggingfaceAdapter(cfg, deps)` that satisfies image-provider.contract.js, then add ONE
 * line here. Select it with IMAGE_EDIT_PROVIDER=huggingface. No route, service, frontend or database change is needed.
 */
const ADAPTERS = {
  [cloudflare.ID]: { configFromEnv: cloudflare.configFromEnv, create: cloudflare.createCloudflareAdapter },
  [photoroom.ID]: { configFromEnv: photoroom.configFromEnv, create: photoroom.createPhotoroomAdapter },
};

export const listImageProviderIds = () => Object.keys(ADAPTERS);

/**
 * @param {string} name value of IMAGE_EDIT_PROVIDER
 * @param {Record<string,string|undefined>} envVars
 * @param {object} [deps]
 * @throws {Error} with a clear message for an unknown provider name
 */
export function createImageProvider(name, envVars, deps) {
  const entry = ADAPTERS[name];
  if (!entry) throw new Error(`Unknown IMAGE_EDIT_PROVIDER "${name}". Implemented image-editing providers: ${listImageProviderIds().join(', ')}`);
  return assertImageProvider(entry.create(entry.configFromEnv(envVars), deps));
}
