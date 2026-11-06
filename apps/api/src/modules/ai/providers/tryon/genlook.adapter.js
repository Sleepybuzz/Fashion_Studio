/**
 * The Genlook adapter is the Phase 3 implementation. It is NOT duplicated: this file only re-exports it so the three
 * capability folders look alike. Its configuration is still read by config/env.js (GENLOOK_API_KEY, ...).
 */
export { createGenlookProvider as createGenlookAdapter } from '../../../tryon/providers/genlook.provider.js';
