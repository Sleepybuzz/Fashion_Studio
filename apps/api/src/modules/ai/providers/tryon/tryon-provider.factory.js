import { createProvider, listProviderIds } from '../../../tryon/providers/index.js';

/**
 * Try-on provider factory. The registry of try-on adapters stays where Phase 3 put it
 * (modules/tryon/providers/index.js): add a try-on adapter there, select it with TRYON_PROVIDER.
 * @param {{provider:string}} tryonConfig env.tryon
 * @param {object} [deps]
 */
export const createTryOnProvider = (tryonConfig, deps) => createProvider(tryonConfig, deps);
export const listTryOnProviderIds = listProviderIds;
