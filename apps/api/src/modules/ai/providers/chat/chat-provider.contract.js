/**
 * Chat AI provider contract. An adapter understands the customer's message and returns text or structured data.
 * Everything provider-specific (URL, auth, payload, response parsing, error codes) stays inside the adapter.
 * The application owns the prompt and validates every answer, so a different provider only has to carry text.
 *
 * @typedef {{role:'user'|'assistant', text:string}} ChatTurn
 *
 * @typedef {object} ChatRequest
 * @property {string} system        system / developer instructions (built by the application)
 * @property {ChatTurn[]} messages  conversation so far, oldest first, ending with the customer's latest message
 * @property {number} [temperature]
 * @property {number} [maxOutputTokens]
 *
 * @typedef {object} ChatTextResult
 * @property {string} text
 * @property {string} model
 * @property {{inputTokens?:number, outputTokens?:number}} [usage]
 *
 * @typedef {object} ChatDataResult
 * @property {object} data          parsed JSON object, NOT yet trusted: the application validates it
 * @property {string} model
 * @property {{inputTokens?:number, outputTokens?:number}} [usage]
 *
 * @typedef {object} ProviderDescription
 * @property {string} id
 * @property {string} label
 * @property {string} operator      legal operator shown in the consent text
 * @property {string} privacyUrl
 * @property {string|null} model    configured model identifier
 * @property {string[]} disclosure  provider-specific facts shown in the consent text
 *
 * @typedef {object} ChatProvider
 * @property {string} id
 * @property {() => string|null} configIssue   null when ready, else a developer-facing description of what is missing
 * @property {() => boolean} isConfigured
 * @property {() => ProviderDescription} describe
 * @property {(req: ChatRequest) => Promise<ChatTextResult>} generateResponse
 * @property {(req: ChatRequest) => Promise<ChatDataResult>} understandInstruction  asks for a JSON object answer
 */

const REQUIRED = ['configIssue', 'isConfigured', 'describe', 'generateResponse', 'understandInstruction'];

/**
 * Fail fast if an adapter does not implement the contract.
 * @param {any} provider
 * @returns {ChatProvider}
 */
export function assertChatProvider(provider) {
  if (!provider || typeof provider.id !== 'string') throw new Error('Chat provider must have an id');
  for (const m of REQUIRED) {
    if (typeof provider[m] !== 'function') throw new Error(`Chat provider "${provider.id}" is missing method ${m}()`);
  }
  return provider;
}
