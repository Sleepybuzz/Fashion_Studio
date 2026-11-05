import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Heart, Package } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import FormField from '../../components/ui/FormField.jsx';
import ProductGrid from '../../components/ProductGrid.jsx';
import { EmptyState, ErrorMessage, Notice, Spinner } from '../../components/ui/Feedback.jsx';
import { usersService, wishlistService } from '../../services/store.service.js';
import { parseError } from '../../services/api.js';
import { useAuthStore } from '../../stores/authStore.js';

export function AccountOverview() {
  const user = useAuthStore((s) => s.user);
  const { data: wishlist } = useQuery({ queryKey: ['wishlist'], queryFn: wishlistService.list });
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h2 className="font-sans text-xl font-semibold">Hello, {user.fullName.split(' ')[0]}</h2>
        <p className="mt-1 text-sm text-muted">{user.email}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/account/wishlist" className="card flex items-center gap-4 p-5 hover:border-brand">
          <Heart className="h-6 w-6 text-brand" aria-hidden="true" />
          <div><p className="font-medium">Wishlist</p><p className="text-sm text-muted">{wishlist ? `${wishlist.length} saved` : '…'}</p></div>
        </Link>
        <Link to="/account/orders" className="card flex items-center gap-4 p-5 hover:border-brand">
          <Package className="h-6 w-6 text-brand" aria-hidden="true" />
          <div><p className="font-medium">Orders</p><p className="text-sm text-muted">View order history</p></div>
        </Link>
      </div>
    </div>
  );
}

export function ProfilePage() {
  const { user, setUser } = useAuthStore();
  const [err, setErr] = useState({ message: '', fields: {} });
  const [saved, setSaved] = useState(false);
  const m = useMutation({
    mutationFn: usersService.updateProfile,
    onSuccess: (u) => { setUser(u); setSaved(true); },
    onError: (e) => setErr(parseError(e)),
  });
  const onSubmit = (e) => {
    e.preventDefault();
    setErr({ message: '', fields: {} }); setSaved(false);
    const f = new FormData(e.currentTarget);
    m.mutate({ fullName: f.get('fullName'), phone: f.get('phone') });
  };
  return (
    <form onSubmit={onSubmit} className="card max-w-xl space-y-4 p-5 sm:p-8" noValidate>
      <h2 className="font-sans text-lg font-semibold">Profile</h2>
      {saved && <Notice>Profile updated.</Notice>}
      {err.message && <Notice type="error">{err.message}</Notice>}
      <FormField label="Full name" name="fullName" defaultValue={user.fullName} required error={err.fields.fullName} />
      <FormField label="Email" value={user.email} disabled readOnly hint="Email cannot be changed here." />
      <FormField label="Phone" name="phone" type="tel" defaultValue={user.phone || ''} error={err.fields.phone} />
      <Button type="submit" loading={m.isPending}>Save changes</Button>
    </form>
  );
}

export function SettingsPage() {
  const [err, setErr] = useState({ message: '', fields: {} });
  const [done, setDone] = useState(false);
  const m = useMutation({
    mutationFn: usersService.changePassword,
    onSuccess: () => setDone(true),
    onError: (e) => setErr(parseError(e)),
  });
  const onSubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    setErr({ message: '', fields: {} }); setDone(false);
    const f = new FormData(form);
    if (f.get('newPassword') !== f.get('confirm')) return setErr({ message: '', fields: { confirm: 'Passwords do not match' } });
    return m.mutate({ currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') }, { onSuccess: () => form.reset() });
  };
  return (
    <form onSubmit={onSubmit} className="card max-w-xl space-y-4 p-5 sm:p-8" noValidate>
      <h2 className="font-sans text-lg font-semibold">Change password</h2>
      {done && <Notice>Password updated.</Notice>}
      {err.message && <Notice type="error">{err.message}</Notice>}
      <FormField label="Current password" name="currentPassword" type="password" autoComplete="current-password" required error={err.fields.currentPassword} />
      <FormField label="New password" name="newPassword" type="password" autoComplete="new-password" required hint="At least 8 characters, with a letter and a number" error={err.fields.newPassword} />
      <FormField label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required error={err.fields.confirm} />
      <Button type="submit" loading={m.isPending}>Update password</Button>
    </form>
  );
}

export function WishlistPage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['wishlist'], queryFn: wishlistService.list });
  if (isLoading) return <Spinner />;
  if (isError) return <ErrorMessage message="Could not load your wishlist." onRetry={refetch} />;
  if (!data.length) {
    return <EmptyState icon={Heart} title="Your wishlist is empty" text="Tap the heart on any product to save it here."
      action={<Button to="/shop" size="sm">Browse products</Button>} />;
  }
  return <ProductGrid products={data.map((p) => ({ ...p, categoryName: null }))} />;
}

export function OrdersPage() {
  return (
    <EmptyState icon={Package} title="No orders yet"
      text="Ordering is not available yet. Once checkout is released, your orders will appear here."
      action={<Button to="/shop" size="sm">Browse products</Button>} />
  );
}
