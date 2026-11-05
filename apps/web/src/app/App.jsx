import { useEffect } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import StoreLayout from '../layouts/StoreLayout.jsx';
import AccountLayout from '../layouts/AccountLayout.jsx';
import AdminLayout from '../layouts/AdminLayout.jsx';
import ProtectedRoute from '../components/ProtectedRoute.jsx';
import HomePage from '../features/products/HomePage.jsx';
import ShopPage from '../features/products/ShopPage.jsx';
import ProductDetailPage from '../features/products/ProductDetailPage.jsx';
import { LoginPage, RegisterPage } from '../features/auth/AuthPages.jsx';
import { AboutPage, ContactPage } from '../features/pages/StaticPages.jsx';
import { AccountOverview, OrdersPage, ProfilePage, SettingsPage, WishlistPage } from '../features/account/AccountPages.jsx';
import { AdminCategories, AdminCustomers, AdminInventory, AdminOverview, AdminSettings } from '../features/admin/AdminPages.jsx';
import { AdminProductEditor, AdminProductList } from '../features/admin/ProductsAdmin.jsx';
import { authService } from '../services/store.service.js';
import { useAuthStore } from '../stores/authStore.js';

function NotFound() {
  return (
    <div className="container-page py-24 text-center">
      <h1 className="h-section">Page not found</h1>
      <Link to="/" className="mt-4 inline-block font-medium text-brand hover:underline">Back to home</Link>
    </div>
  );
}

export default function App() {
  const { token, setUser, logout } = useAuthStore();

  // Re-validate the stored session on load (also refreshes role/name changes).
  useEffect(() => {
    if (!token) return;
    authService.me().then(setUser).catch((e) => { if (e?.response?.status === 401) logout(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <Routes>
      <Route element={<StoreLayout />}>
        <Route index element={<HomePage />} />
        <Route path="shop" element={<ShopPage />} />
        <Route path="shop/:slug" element={<ProductDetailPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />

        <Route element={<ProtectedRoute role="customer" />}>
          <Route path="account" element={<AccountLayout />}>
            <Route index element={<AccountOverview />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="wishlist" element={<WishlistPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route element={<ProtectedRoute role="admin" />}>
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<AdminOverview />} />
          <Route path="products" element={<AdminProductList />} />
          <Route path="products/new" element={<AdminProductEditor />} />
          <Route path="products/:id" element={<AdminProductEditor />} />
          <Route path="categories" element={<AdminCategories />} />
          <Route path="inventory" element={<AdminInventory />} />
          <Route path="customers" element={<AdminCustomers />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
      </Route>
    </Routes>
  );
}
