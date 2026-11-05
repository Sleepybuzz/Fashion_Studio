import axios from 'axios';
import { useAuthStore } from '../stores/authStore.js';

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');

/** Centralised Axios instance. Attaches the JWT and logs out on 401 for authenticated calls. */
export const api = axios.create({ baseURL: `${API_URL}/api`, timeout: 15000 });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error) => {
    const hadToken = !!useAuthStore.getState().token;
    const isAuthCall = error.config?.url?.startsWith('/auth/login') || error.config?.url?.startsWith('/auth/register');
    if (error.response?.status === 401 && hadToken && !isAuthCall) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  },
);

/** Turn an Axios error into { message, fields }. */
export function parseError(error) {
  if (error?.response?.data?.error) {
    const { message, details } = error.response.data.error;
    return { message, fields: details && typeof details === 'object' ? details : {} };
  }
  if (error?.code === 'ERR_NETWORK' || error?.code === 'ECONNABORTED') {
    return { message: 'Cannot reach the server. Please check your connection and try again.', fields: {} };
  }
  return { message: 'Something went wrong. Please try again.', fields: {} };
}

/** Resolve a stored image URL (relative /uploads/... or absolute https) for <img src>. */
export const imageSrc = (url) => (!url ? null : url.startsWith('/') ? `${API_URL}${url}` : url);
