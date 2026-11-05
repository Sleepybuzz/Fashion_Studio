/**
 * Virtual try-on provider contract.
 *
 * A provider adapter is a plain object created by a factory. Everything provider-specific (URLs, headers,
 * request bodies, status vocabulary, error codes) stays inside the adapter; the rest of the app only sees the
 * normalized shapes below. To add a provider: write an adapter that satisfies this contract and register it in
 * `providers/index.js`. No database, route or frontend change is needed.
 *
 * @typedef {object} TryOnImageInput
 * @property {Buffer} buffer
 * @property {string} mimeType  image/jpeg | image/png | image/webp
 * @property {string} filename  server-generated, never the client's name
 *
 * @typedef {object} SubmitTryOnInput
 * @property {string} externalUserId  opaque id (never an email or name) used for provider-side deletion
 * @property {TryOnImageInput} photo  the customer's photo
 * @property {{externalId:string, title:string, description:string, images:TryOnImageInput[]}} garment
 *
 * @typedef {object} NormalizedStatus
 * @property {'pending'|'processing'|'completed'|'failed'} state
 * @property {string} [resultUrl]   temporary URL of the generated image (completed only)
 * @property {string} [errorCode]   one of PROVIDER_ERROR (failed only)
 * @property {string} [providerErrorCode] raw provider code, for admin diagnostics only
 *
 * @typedef {object} TryOnProvider
 * @property {string} id
 * @property {() => string|null} configIssue  null when ready, otherwise a developer-facing description of what is missing
 * @property {() => boolean} isConfigured
 * @property {() => ProviderDescription} describe
 * @property {(input: SubmitTryOnInput) => Promise<{jobId:string}>} submitTryOn   MUST NOT be retried automatically (paid)
 * @property {(jobId: string) => Promise<NormalizedStatus>} getStatus
 * @property {(externalUserId: string) => Promise<void>} deleteUserData
 * @property {() => Promise<{balance:number}|null>} [getCredits]
 *
 * @typedef {object} ProviderDescription
 * @property {string} id
 * @property {string} label           short display name, e.g. "Genlook"
 * @property {string} operator        legal operator shown in the consent text
 * @property {string} privacyUrl
 * @property {number} retentionDays   how long the provider keeps uploaded photos / results
 * @property {boolean} testMode       true when results are NOT real AI output
 * @property {string[]} disclosure    extra provider-specific facts shown in the consent text
 */

/** Stable, provider-neutral error codes. */
export const PROVIDER_ERROR = Object.freeze({
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_PHOTO: 'INVALID_PHOTO',
  INVALID_GARMENT: 'INVALID_GARMENT',
  UNSUPPORTED_PRODUCT: 'UNSUPPORTED_PRODUCT',
  CONTENT_POLICY: 'CONTENT_POLICY',
  UNAVAILABLE: 'UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  GENERATION_FAILED: 'GENERATION_FAILED',
  INTERNAL: 'INTERNAL',
});

/** Error thrown by adapters. `message` is the normalized code only: it never contains provider text or secrets. */
export class ProviderError extends Error {
  /**
   * @param {string} code one of PROVIDER_ERROR
   * @param {{providerCode?:string, httpStatus?:number, providerMessage?:string}} [meta]
   */
  constructor(code, meta = {}) {
    super(code);
    this.name = 'ProviderError';
    this.code = code;
    this.providerCode = meta.providerCode || null;
    this.httpStatus = meta.httpStatus || null;
    // For server logs only. Truncated; never shown to customers.
    this.providerMessage = meta.providerMessage ? String(meta.providerMessage).slice(0, 200) : null;
  }
}

const REQUIRED = ['configIssue', 'isConfigured', 'describe', 'submitTryOn', 'getStatus', 'deleteUserData'];

/**
 * Fail fast if an adapter does not implement the contract.
 * @param {any} provider
 * @returns {TryOnProvider}
 */
export function assertProvider(provider) {
  if (!provider || typeof provider.id !== 'string') throw new Error('Try-on provider must have an id');
  for (const m of REQUIRED) {
    if (typeof provider[m] !== 'function') throw new Error(`Try-on provider "${provider.id}" is missing method ${m}()`);
  }
  return provider;
}
