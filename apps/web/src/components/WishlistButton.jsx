import { Heart } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore.js';
import { useToggleWishlist, useWishlistIds } from '../hooks/useStore.js';

/** Heart toggle. Signed-out users are sent to login. Admins have no wishlist. */
export default function WishlistButton({ productId, className = '' }) {
  const { token, user } = useAuthStore();
  const { data: ids = [] } = useWishlistIds();
  const toggle = useToggleWishlist();
  const navigate = useNavigate();
  const location = useLocation();

  if (user?.role === 'admin') return null;
  const on = ids.includes(productId);

  const onClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!token) return navigate('/login', { state: { from: location.pathname } });
    return toggle.mutate({ id: productId, on });
  };

  return (
    <button onClick={onClick} disabled={toggle.isPending} aria-pressed={on}
      aria-label={on ? 'Remove from wishlist' : 'Add to wishlist'}
      className={`flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-sm transition hover:bg-white ${className}`}>
      <Heart className={`h-5 w-5 ${on ? 'fill-brand text-brand' : 'text-ink'}`} aria-hidden="true" />
    </button>
  );
}
