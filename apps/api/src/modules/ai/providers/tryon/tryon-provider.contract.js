/**
 * Virtual try-on provider contract (Phase 3, unchanged). It is defined once, in
 * modules/tryon/providers/provider.contract.js, and re-exported here so all three AI capability contracts can be found
 * in one place. Canonical Phase 5 method names are `generateTryOn()` and `getTryOnStatus()`; the Phase 3 names
 * `submitTryOn()` / `getStatus()` are kept as aliases so existing code keeps working.
 */
export { assertProvider as assertTryOnProvider, PROVIDER_ERROR, ProviderError } from '../../../tryon/providers/provider.contract.js';
