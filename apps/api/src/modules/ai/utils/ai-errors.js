import { PROVIDER_ERROR as E } from '../providers/errors.js';

/**
 * What a customer is told for each normalized provider error. Provider text is never shown to customers.
 * `retryable`: whether sending the request again can reasonably succeed.
 */
const TABLE = {
  [E.NOT_CONFIGURED]: { retryable: false, message: 'AI customization is temporarily unavailable. Please try again later.' },
  [E.INSUFFICIENT_CREDITS]: { retryable: false, message: 'AI customization has reached its usage allowance for now. Please try again later.' },
  [E.QUOTA_EXCEEDED]: { retryable: false, message: 'The AI service has reached its usage allowance for now. Please try again later.' },
  [E.RATE_LIMITED]: { retryable: true, message: 'The AI service is busy right now. Please wait a minute and try again.' },
  [E.INVALID_PHOTO]: { retryable: false, message: 'The AI service could not use this image. Try a clearer, well-lit garment photo.' },
  [E.INVALID_GARMENT]: { retryable: false, message: 'The AI service could not use this image.' },
  [E.UNSUPPORTED_PRODUCT]: { retryable: false, message: 'This kind of request is not supported.' },
  [E.CONTENT_POLICY]: { retryable: false, message: 'The AI service declined this request. Please rephrase it or try something different.' },
  [E.UNAVAILABLE]: { retryable: true, message: 'The AI service is temporarily unavailable. Please try again in a few minutes.' },
  [E.TIMEOUT]: { retryable: true, message: 'The AI service took too long to respond. Please try again.' },
  [E.GENERATION_FAILED]: { retryable: true, message: 'The AI service could not complete this request. Please try again or rephrase it.' },
  [E.INTERNAL]: { retryable: true, message: 'Something went wrong. Please try again.' },
};

/** @param {string|null|undefined} code */
export function describeAiError(code) {
  const known = TABLE[code];
  const entry = known || TABLE[E.INTERNAL];
  return { code: known ? code : E.INTERNAL, retryable: entry.retryable, message: entry.message };
}
