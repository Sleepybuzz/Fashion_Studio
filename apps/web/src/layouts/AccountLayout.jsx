import { NavLink, Outlet } from 'react-router-dom';
import { Box, Camera, Heart, LayoutDashboard, Package, Settings, Sparkles, UserCircle } from 'lucide-react';

const items = [
  { to: '/account', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/account/profile', label: 'Profile', icon: UserCircle },
  { to: '/account/wishlist', label: 'Wishlist', icon: Heart },
  { to: '/account/designs', label: '3D designs', icon: Box },
  { to: '/account/ai-designs', label: 'AI designs', icon: Sparkles },
  { to: '/account/try-ons', label: 'Try-ons', icon: Sparkles },
  { to: '/account/ar-captures', label: 'AR captures', icon: Camera },
  { to: '/account/orders', label: 'Orders', icon: Package },
  { to: '/account/settings', label: 'Settings', icon: Settings },
];

export default function AccountLayout() {
  return (
    <div className="container-page py-8 sm:py-12">
      <h1 className="h-section mb-6">My account</h1>
      <div className="grid gap-6 lg:grid-cols-[220px_1fr] lg:gap-10">
        <nav aria-label="Account" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-sm lg:rounded-xl ${isActive ? 'bg-ink text-white' : 'text-muted hover:bg-sand hover:text-ink'}`}>
              <Icon className="h-4 w-4" aria-hidden="true" />{label}
            </NavLink>
          ))}
        </nav>
        <section className="min-w-0"><Outlet /></section>
      </div>
    </div>
  );
}
