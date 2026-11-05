import { api } from './api.js';

/** Customer virtual try-on. The browser talks only to our API; the AI provider is never contacted directly. */
export const tryOnService = {
  config: () => api.get('/tryon/config').then((r) => r.data),
  eligibility: (slug) => api.get(`/tryon/eligibility/${encodeURIComponent(slug)}`).then((r) => r.data),
  list: (params) => api.get('/tryon/sessions', { params }).then((r) => r.data),
  get: (id) => api.get(`/tryon/sessions/${id}`).then((r) => r.data.session),
  /** @param {FormData} form fields: photo, productId, consent, consentVersion */
  create: (form, onProgress) => api.post('/tryon/sessions', form, {
    timeout: 90000,
    onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
  }).then((r) => r.data.session),
  retry: (id) => api.post(`/tryon/sessions/${id}/retry`).then((r) => r.data.session),
  setSaved: (id, saved) => api.patch(`/tryon/sessions/${id}/saved`, { saved }).then((r) => r.data.session),
  remove: (id) => api.delete(`/tryon/sessions/${id}`),
  removeAll: () => api.delete('/tryon/sessions').then((r) => r.data),
};

/** Store owner: garment photos, eligibility and usage. No customer photo is ever returned to admins. */
export const adminTryOnService = {
  overview: () => api.get('/admin/tryon/overview').then((r) => r.data),
  credits: () => api.get('/admin/tryon/provider/credits').then((r) => r.data),
  products: () => api.get('/admin/tryon/products').then((r) => r.data.items),
  product: (id) => api.get(`/admin/tryon/products/${id}`).then((r) => r.data),
  saveConfig: (id, body) => api.patch(`/admin/tryon/products/${id}`, body).then((r) => r.data),
  addImage: (id, file) => {
    const form = new FormData();
    form.append('image', file);
    return api.post(`/admin/tryon/products/${id}/images`, form, { timeout: 60000 }).then((r) => r.data);
  },
  replaceImage: (id, imageId, file) => {
    const form = new FormData();
    form.append('image', file);
    return api.put(`/admin/tryon/products/${id}/images/${imageId}`, form, { timeout: 60000 }).then((r) => r.data);
  },
  removeImage: (id, imageId) => api.delete(`/admin/tryon/products/${id}/images/${imageId}`).then((r) => r.data),
};
