import { api } from './api.js';

export const authService = {
  register: (body) => api.post('/auth/register', body).then((r) => r.data),
  login: (body) => api.post('/auth/login', body).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data.user),
};

export const usersService = {
  updateProfile: (body) => api.patch('/users/me', body).then((r) => r.data.user),
  changePassword: (body) => api.put('/users/me/password', body).then((r) => r.data),
};

export const catalogService = {
  products: (params) => api.get('/products', { params }).then((r) => r.data),
  product: (slug) => api.get(`/products/${encodeURIComponent(slug)}`).then((r) => r.data.product),
  categories: () => api.get('/categories').then((r) => r.data.items),
  storeInfo: () => api.get('/store-info').then((r) => r.data),
};

export const wishlistService = {
  list: () => api.get('/wishlist').then((r) => r.data.items),
  ids: () => api.get('/wishlist/ids').then((r) => r.data.productIds),
  add: (id) => api.put(`/wishlist/${id}`),
  remove: (id) => api.delete(`/wishlist/${id}`),
};

export const adminService = {
  stats: () => api.get('/admin/stats').then((r) => r.data),
  inventory: () => api.get('/admin/inventory').then((r) => r.data.items),
  customers: () => api.get('/admin/customers').then((r) => r.data.items),
  settings: () => api.get('/admin/settings').then((r) => r.data.settings),
  saveSettings: (body) => api.put('/admin/settings', body).then((r) => r.data.settings),
  products: (params) => api.get('/admin/products', { params }).then((r) => r.data),
  product: (id) => api.get(`/admin/products/${id}`).then((r) => r.data.product),
  createProduct: (body) => api.post('/admin/products', body).then((r) => r.data.product),
  updateProduct: (id, body) => api.put(`/admin/products/${id}`, body).then((r) => r.data.product),
  deleteProduct: (id) => api.delete(`/admin/products/${id}`),
  categories: () => api.get('/admin/categories').then((r) => r.data.items),
  createCategory: (body) => api.post('/admin/categories', body).then((r) => r.data.category),
  updateCategory: (id, body) => api.put(`/admin/categories/${id}`, body).then((r) => r.data.category),
  deleteCategory: (id) => api.delete(`/admin/categories/${id}`),
  uploadImage: (file) => {
    const form = new FormData();
    form.append('image', file);
    return api.post('/admin/uploads/product-image', form).then((r) => r.data.url);
  },
};
