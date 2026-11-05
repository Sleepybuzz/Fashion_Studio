import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore.js';

/**
 * Route guard. `role` restricts to one role. This is UX only: the API enforces the real authorization.
 */
export default function ProtectedRoute({ role }) {
  const { token, user } = useAuthStore();
  const location = useLocation();
  if (!token || !user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (role && user.role !== role) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/account'} replace />;
  }
  return <Outlet />;
}
