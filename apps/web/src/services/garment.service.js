import { api } from './api.js';

/** Public studio + customer saved designs. */
export const garmentService = {
  studio: (slug) => api.get(`/garments/studio/${encodeURIComponent(slug)}`).then((r) => r.data),
  designs: () => api.get('/customizations').then((r) => r.data),
  design: (id) => api.get(`/customizations/${id}`).then((r) => r.data.design),
  createDesign: (body) => api.post('/customizations', body).then((r) => r.data.design),
  updateDesign: (id, body) => api.put(`/customizations/${id}`, body).then((r) => r.data.design),
  deleteDesign: (id) => api.delete(`/customizations/${id}`),
};

/** Admin 3D asset management. */
export const adminGarmentService = {
  list: () => api.get('/admin/garments').then((r) => r.data),
  get: (productId) => api.get(`/admin/garments/product/${productId}`).then((r) => r.data),
  uploadModel: (productId, file, onProgress) => {
    const form = new FormData();
    form.append('model', file);
    return api.put(`/admin/garments/product/${productId}/model`, form, {
      timeout: 180000,
      onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
    }).then((r) => r.data);
  },
  updateMaterials: (productId, customizableMaterials) =>
    api.patch(`/admin/garments/product/${productId}/model`, { customizableMaterials }).then((r) => r.data),
  removeModel: (productId) => api.delete(`/admin/garments/product/${productId}/model`),
  saveOptions: (productId, options) => api.put(`/admin/garments/product/${productId}/options`, { options }).then((r) => r.data),
  /** Authenticated download of the model (works for draft products) as a Blob for admin preview. */
  modelBlob: (productId) => api.get(`/admin/garments/product/${productId}/model/file`, { responseType: 'blob', timeout: 120000 }).then((r) => r.data),
};
