/**
 * Image-editing AI provider contract. An adapter performs REAL image-to-image editing: it receives an input garment
 * image and an instruction and returns the edited image. The application builds the prompt; the adapter only
 * carries it to the provider and normalizes the answer and every error.
 *
 * @typedef {object} ImageInput
 * @property {Buffer} buffer
 * @property {string} mimeType  image/jpeg | image/png | image/webp
 *
 * @typedef {object} EditImageRequest
 * @property {ImageInput} image
 * @property {string} prompt
 * @property {{width:number, height:number}} [size]  size of the input; used to keep the original framing
 * @property {number} [seed]
 * @property {string} [requestId]  our own id, for logs only
 *
 * @typedef {object} EditImageResult
 * @property {ImageInput} image    the edited image
 * @property {string} model        model identifier actually used
 * @property {Record<string, string|number|boolean>} [meta]   non-sensitive facts to store (e.g. latency)
 *
 * @typedef {object} ImageProvider
 * @property {string} id
 * @property {() => string|null} configIssue
 * @property {() => boolean} isConfigured
 * @property {() => import('../chat/chat-provider.contract.js').ProviderDescription} describe
 * @property {(req: EditImageRequest) => Promise<EditImageResult>} editImage   MUST NOT be retried automatically (paid)
 * @property {(jobId: string) => Promise<{state:'pending'|'processing'|'completed'|'failed', image?:ImageInput, errorCode?:string}>} [getGenerationStatus]
 *           only for providers that process asynchronously; omitted by synchronous providers
 */

const REQUIRED = ['configIssue', 'isConfigured', 'describe', 'editImage'];

/**
 * @param {any} provider
 * @returns {ImageProvider}
 */
export function assertImageProvider(provider) {
  if (!provider || typeof provider.id !== 'string') throw new Error('Image provider must have an id');
  for (const m of REQUIRED) {
    if (typeof provider[m] !== 'function') throw new Error(`Image provider "${provider.id}" is missing method ${m}()`);
  }
  return provider;
}
