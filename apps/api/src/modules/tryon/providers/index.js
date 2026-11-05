import { PROVIDER_ERROR as E, ProviderError, assertProvider } from './provider.contract.js';
import { createGenlookProvider } from './genlook.provider.js';

/**
 * Provider registry. To add a provider: implement the contract in providers/provider.contract.js, add an
 * entry here and its settings to `config/env.js` (e.g. TRYON_PROVIDER=another and ANOTHER_API_KEY=...).
 * @type {Record<string, (tryonConfig: any, deps?: any) => any>}
 */
const REGISTRY = {
  genlook: (cfg, deps) => createGenlookProvider(cfg.genlook, deps),
};

export const listProviderIds = () => Object.keys(REGISTRY);

/** A provider that is never usable. Used when TRYON_PROVIDER names an unknown provider. Never produces results. */
function createUnavailableProvider(id, issue) {
  const fail = async () => { throw new ProviderError(E.NOT_CONFIGURED, { providerCode: 'UNKNOWN_PROVIDER' }); };
  return {
    id,
    configIssue: () => issue,
    isConfigured: () => false,
    describe: () => ({ id, label: id, operator: id, privacyUrl: '', retentionDays: 0, testMode: false, disclosure: [] }),
    submitTryOn: fail,
    getStatus: fail,
    deleteUserData: fail,
  };
}

/**
 * Select the active provider from configuration. Never falls back to a fake/simulated provider.
 * @param {{provider:string}} tryonConfig
 * @param {object} [deps] e.g. { fetchImpl } for tests
 */
export function createProvider(tryonConfig, deps) {
  const factory = REGISTRY[tryonConfig.provider];
  if (!factory) {
    return createUnavailableProvider(
      tryonConfig.provider,
      `Unknown TRYON_PROVIDER "${tryonConfig.provider}". Supported: ${listProviderIds().join(', ')}`,
    );
  }
  return assertProvider(factory(tryonConfig, deps));
}
