import { Suspense, lazy, useEffect } from 'react';
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
import { Spinner } from '../components/ui/Feedback.jsx';
import SavedDesignsPage from '../features/account/SavedDesignsPage.jsx';
import MyTryOnsPage from '../features/account/MyTryOnsPage.jsx';
import VirtualTryOnPage from '../features/virtual-tryon/VirtualTryOnPage.jsx';
import TryOnSessionPage from '../features/virtual-tryon/TryOnSessionPage.jsx';
import { AdminTryOnList, AdminTryOnManage } from '../features/admin/AdminTryOn.jsx';
import MyArCapturesPage from '../features/account/MyArCapturesPage.jsx';
import { AdminArList, AdminArManage } from '../features/admin/AdminAr.jsx';
import { authService } from '../services/store.service.js';
import { useAuthStore } from '../stores/authStore.js';

// The 3D code (three.js) is only downloaded when the studio or the admin 3D screens are opened.
const GarmentStudioPage = lazy(() => import('../features/garment-studio/GarmentStudioPage.jsx'));
// Phase 4: three.js + MediaPipe are only downloaded when a customer opens the AR page.
const ArTryOnPage = lazy(() => import('../features/ar-tryon/ArTryOnPage.jsx'));
const AdminGarmentList = lazy(() => import('../features/admin/AdminGarments.jsx').then((m) => ({ default: m.AdminGarmentList })));
const AdminGarmentManage = lazy(() => import('../features/admin/AdminGarments.jsx').then((m) => ({ default: m.AdminGarmentManage })));

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
    <Suspense fallback={<Spinner label="Loading…" className="py-32" />}>
    <Routes>
      <Route element={<StoreLayout />}>
        <Route index element={<HomePage />} />
        <Route path="shop" element={<ShopPage />} />
        <Route path="shop/:slug" element={<ProductDetailPage />} />
        <Route path="studio/:slug" element={<GarmentStudioPage />} />
        <Route path="ar-try-on/:slug" element={<ArTryOnPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />

        <Route element={<ProtectedRoute role="customer" />}>
          <Route path="try-on/:slug" element={<VirtualTryOnPage />} />
          <Route path="account" element={<AccountLayout />}>
            <Route index element={<AccountOverview />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="wishlist" element={<WishlistPage />} />
            <Route path="designs" element={<SavedDesignsPage />} />
            <Route path="try-ons" element={<MyTryOnsPage />} />
            <Route path="try-ons/:id" element={<TryOnSessionPage />} />
            <Route path="ar-captures" element={<MyArCapturesPage />} />
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
          <Route path="3d-assets" element={<AdminGarmentList />} />
          <Route path="3d-assets/:productId" element={<AdminGarmentManage />} />
          <Route path="try-on" element={<AdminTryOnList />} />
          <Route path="try-on/:productId" element={<AdminTryOnManage />} />
          <Route path="ar" element={<AdminArList />} />
          <Route path="ar/:productId" element={<AdminArManage />} />
          <Route path="categories" element={<AdminCategories />} />
          <Route path="inventory" element={<AdminInventory />} />
          <Route path="customers" element={<AdminCustomers />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
      </Route>
    </Routes>
    </Suspense>
  );
}
