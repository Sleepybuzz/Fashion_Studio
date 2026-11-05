import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Menu, User, X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore.js';
import { useStoreInfo } from '../hooks/useStore.js';

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/shop', label: 'Shop' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuthStore();
  const { data: info } = useStoreInfo();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const dashboard = user?.role === 'admin' ? '/admin' : '/account';
  const linkCls = ({ isActive }) => `text-sm transition-colors hover:text-brand ${isActive ? 'font-medium text-ink' : 'text-muted'}`;

  const onLogout = () => { logout(); navigate('/'); };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link to="/" className="font-display text-lg font-semibold tracking-tight sm:text-xl">
          {info?.storeName || 'AI Fashion Studio'}
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Main">
          {links.map((l) => <NavLink key={l.to} to={l.to} end={l.end} className={linkCls}>{l.label}</NavLink>)}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {user ? (
            <>
              <Link to={dashboard} className="flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm hover:bg-sand">
                <User className="h-4 w-4" aria-hidden="true" />
                <span className="max-w-[10rem] truncate">{user.fullName}</span>
              </Link>
              <button onClick={onLogout} aria-label="Log out" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-sand">
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-sm text-muted hover:text-ink">Log in</Link>
              <Link to="/register" className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white hover:bg-black">Create account</Link>
            </>
          )}
        </div>

        <button className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-sand md:hidden"
          onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? 'Close menu' : 'Open menu'}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <nav id="mobile-menu" aria-label="Mobile" className="border-t border-line bg-canvas md:hidden">
          <div className="container-page flex flex-col py-3">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `py-3 text-base ${isActive ? 'font-medium' : 'text-muted'}`}>{l.label}</NavLink>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-line pt-4">
              {user ? (
                <>
                  <Link to={dashboard} className="py-2 text-base">My {user.role === 'admin' ? 'dashboard' : 'account'}</Link>
                  <button onClick={onLogout} className="py-2 text-left text-base text-muted">Log out</button>
                </>
              ) : (
                <>
                  <Link to="/login" className="py-2 text-base">Log in</Link>
                  <Link to="/register" className="rounded-full bg-ink py-3 text-center text-base font-medium text-white">Create account</Link>
                </>
              )}
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}