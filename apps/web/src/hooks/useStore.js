import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogService, wishlistService } from '../services/store.service.js';
import { useAuthStore } from '../stores/authStore.js';

export function useStoreInfo() {
  return useQuery({ queryKey: ['store-info'], queryFn: catalogService.storeInfo, staleTime: 5 * 60_000 });
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: catalogService.categories });
}

/** Wishlist product ids for the signed-in customer (empty set when signed out). */
export function useWishlistIds() {
  const token = useAuthStore((s) => s.token);
  return useQuery({ queryKey: ['wishlist-ids'], queryFn: wishlistService.ids, enabled: !!token });
}

export function useToggleWishlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, on }) => (on ? wishlistService.remove(id) : wishlistService.add(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wishlist-ids'] });
      qc.invalidateQueries({ queryKey: ['wishlist'] });
    },
  });
}
