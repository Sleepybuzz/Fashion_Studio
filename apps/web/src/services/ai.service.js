import { api } from './api.js';

/**
 * AI customization. The browser only ever talks to our own API; it never contacts Gemini, Cloudflare or Genlook
 * and no provider names or keys are known here (labels come from the API).
 */
export const aiService = {
  /** Public: which capabilities are available right now. */
  status: () => api.get('/ai/status').then((r) => r.data),
  config: () => api.get('/ai/config').then((r) => r.data),
  sessions: (params) => api.get('/ai/sessions', { params }).then((r) => r.data.items),
  /** @param {FormData} form fields: type, productId | (image, title), viewHint, consent, consentVersion */
  createSession: (form, onProgress) => api.post('/ai/sessions', form, {
    timeout: 60000,
    onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
  }).then((r) => r.data),
  session: (id) => api.get(`/ai/sessions/${id}`).then((r) => r.data.session),
  removeSession: (id) => api.delete(`/ai/sessions/${id}`),
  removeAll: () => api.delete('/ai/sessions').then((r) => r.data),
  /** The Chat AI call happens before the response, so allow it some time. Image generation continues in the background. */
  send: (id, message, requestId) => api.post(`/ai/sessions/${id}/messages`, { message, requestId }, { timeout: 60000 }).then((r) => r.data.session),
  restore: (id, versionId) => api.post(`/ai/sessions/${id}/versions/${versionId}/restore`).then((r) => r.data.session),
  restoreOriginal: (id) => api.post(`/ai/sessions/${id}/restore-original`).then((r) => r.data.session),
  removeVersion: (id, versionId) => api.delete(`/ai/sessions/${id}/versions/${versionId}`).then((r) => r.data.session),
  save: (id, body) => api.post(`/ai/sessions/${id}/saved`, body).then((r) => r.data.saved),
  saved: () => api.get('/ai/saved').then((r) => r.data.items),
  removeSaved: (savedId) => api.delete(`/ai/saved/${savedId}`),
  tryOnMethods: (id, versionId) => api.get(`/ai/sessions/${id}/tryon-methods`, { params: versionId ? { versionId } : {} }).then((r) => r.data),
};
