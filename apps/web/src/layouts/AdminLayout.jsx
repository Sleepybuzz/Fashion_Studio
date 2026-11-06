import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Boxes, Box, ScanFace, ChevronDown, LayoutDashboard, LogOut, Menu, Package, Settings, Sparkles, Store, Tags, Users, X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore.js';

const items = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/products', label: 'Products', icon: Package },
  { to: '/admin/3d-assets', label: '3D assets', icon: Box },
  { to: '/admin/try-on', label: 'Virtual try-on', icon: Sparkles },
  { to: '/admin/ar', label: 'AR try-on', icon: ScanFace },
  { to: '/admin/categories', label: 'Categories', icon: Tags },
  { to: '/admin/inventory', label: 'Inventory', icon: Boxes },
  { to: '/admin/customers', label: 'Customers', icon: Users },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
];

function Sidebar({ onNavigate }) {
  return (
    <nav aria-label="Admin" className="flex h-full flex-col gap-1 p-4">
      <Link to="/admin" onClick={onNavigate} className="mb-4 px-3 font-display text-lg font-semibold">Studio Admin</Link>
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} onClick={onNavigate}
          className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${isActive ? 'bg-ink text-white' : 'text-muted hover:bg-sand hover:text-ink'}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />{label}
        </NavLink>
      ))}
      <Link to="/" onClick={onNavigate} className="mt-auto flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-sand hover:text-ink">
        <Store className="h-4 w-4" aria-hidden="true" />View storefront
      </Link>
    </nav>
  );
}

export default function AdminLayout() {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); setMenu(false); }, [pathname]);

  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-white lg:block"><Sidebar /></aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 max-w-[80vw] bg-white shadow-xl">
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full hover:bg-sand"><X className="h-5 w-5" /></button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur sm:px-6">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-sand lg:hidden"><Menu className="h-5 w-5" /></button>
          <div className="hidden lg:block" />
          <div className="relative">
            <button onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu"
              className="flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm hover:bg-sand">
              <span className="max-w-[10rem] truncate">{user?.fullName}</span><ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 mt-2 w-48 rounded-xl border border-line bg-white p-1 shadow-lg">
                <Link role="menuitem" to="/" className="block rounded-lg px-3 py-2 text-sm hover:bg-sand">View storefront</Link>
                <button role="menuitem" onClick={() => { logout(); navigate('/login'); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-sand"><LogOut className="h-4 w-4" aria-hidden="true" />Log out</button>
              </div>
            )}
          </div>
        </header>
        <main className="p-4 sm:p-6 lg:p-8"><Outlet /></main>
      </div>
    </div>
  );
}
