import { PROVIDER_ERROR as E } from './providers/provider.contract.js';

/**
 * What a customer is told for each normalized error code. Provider responses are never shown to customers.
 * `retryable`: whether "Try again" with the same photo can reasonably succeed.
 */
const TABLE = {
  [E.NOT_CONFIGURED]: { retryable: false, message: 'Virtual try-on is temporarily unavailable. Please try again later.' },
  [E.INSUFFICIENT_CREDITS]: { retryable: true, message: 'Virtual try-on is temporarily unavailable. Please try again later.' },
  [E.QUOTA_EXCEEDED]: { retryable: true, message: 'The try-on service is busy right now. Please wait a few minutes and try again.' },
  [E.RATE_LIMITED]: { retryable: true, message: 'The try-on service is busy right now. Please wait a minute and try again.' },
  [E.INVALID_PHOTO]: { retryable: false, message: 'We could not use this photo. Try a clear, well-lit, full or half-body photo where your body is fully visible.' },
  [E.INVALID_GARMENT]: { retryable: false, message: 'This item cannot be tried on right now. Please contact the store if this continues.' },
  [E.UNSUPPORTED_PRODUCT]: { retryable: false, message: 'This item cannot be tried on virtually.' },
  [E.CONTENT_POLICY]: { retryable: false, message: 'This item cannot be tried on virtually.' },
  [E.UNAVAILABLE]: { retryable: true, message: 'The try-on service is temporarily unavailable. Please try again in a few minutes.' },
  [E.TIMEOUT]: { retryable: true, message: 'The try-on took too long to complete. Please try again.' },
  [E.GENERATION_FAILED]: { retryable: true, message: 'We could not generate this try-on. Please try again.' },
  [E.INTERNAL]: { retryable: true, message: 'Something went wrong while creating your try-on. Please try again.' },
};

/** @param {string|null|undefined} code */
export function describeTryOnError(code) {
  const entry = TABLE[code] || TABLE[E.INTERNAL];
  return { code: TABLE[code] ? code : E.INTERNAL, retryable: entry.retryable, message: entry.message };
}
