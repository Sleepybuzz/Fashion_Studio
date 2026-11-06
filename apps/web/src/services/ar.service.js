import { api } from './api.js';

/** Real-time AR try-on. Body tracking runs in the browser; only screenshots the customer chooses to save are uploaded. */
export const arService = {
  product: (slug) => api.get(`/ar/products/${encodeURIComponent(slug)}`).then((r) => r.data),
  list: () => api.get('/ar/captures').then((r) => r.data),
  /** @param {FormData} form fields: image, productId, consent, consentVersion, config? */
  save: (form, onProgress) => api.post('/ar/captures', form, {
    timeout: 60000,
    onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
  }).then((r) => r.data.capture),
  remove: (id) => api.delete(`/ar/captures/${id}`),
  removeAll: () => api.delete('/ar/captures').then((r) => r.data),
};

/** Store owner: AR eligibility, positioning and transparent overlay images. */
export const adminArService = {
  list: () => api.get('/admin/ar/products').then((r) => r.data.items),
  get: (id) => api.get(`/admin/ar/products/${id}`).then((r) => r.data),
  save: (id, body) => api.patch(`/admin/ar/products/${id}`, body).then((r) => r.data),
  uploadOverlay: (id, file) => {
    const form = new FormData();
    form.append('overlay', file);
    return api.put(`/admin/ar/products/${id}/overlay`, form, { timeout: 60000 }).then((r) => r.data);
  },
  removeOverlay: (id) => api.delete(`/admin/ar/products/${id}/overlay`).then((r) => r.data),
  overlayBlob: (id) => api.get(`/admin/ar/products/${id}/overlay/file`, { responseType: 'blob' }).then((r) => r.data),
};
