import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Auth state. The JWT is persisted in localStorage so sessions survive reloads.
 * Trade-off: localStorage is readable by any script on the page; keep the app free of
 * untrusted scripts. HttpOnly-cookie sessions can be considered in Phase 7.
 */
export const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      setSession: ({ token, user }) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'afs-auth', partialize: (s) => ({ token: s.token, user: s.user }) },
  ),
);
