import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Package, Pencil, Tags, Trash2, Users } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import FormField from '../../components/ui/FormField.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { EmptyState, ErrorMessage, Notice, Spinner } from '../../components/ui/Feedback.jsx';
import { adminService } from '../../services/store.service.js';
import { parseError } from '../../services/api.js';
import { formatDate } from '../../utils/format.js';

function Stat({ icon: Icon, label, value, note }) {
  return (
    <div className="card p-5">
      <Icon className="h-5 w-5 text-brand" aria-hidden="true" />
      <p className="mt-3 text-2xl font-semibold">{value}</p>
      <p className="text-sm text-muted">{label}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

export function AdminOverview() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-stats'], queryFn: adminService.stats });
  if (isLoading) return <Spinner />;
  if (isError) return <ErrorMessage message="Could not load dashboard." onRetry={refetch} />;
  return (
    <div>
      <h1 className="font-sans text-2xl font-semibold">Overview</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Package} label="Products" value={data.products.total} note={`${data.products.active} active, ${data.products.draft} draft`} />
        <Stat icon={Tags} label="Categories" value={data.categories} />
        <Stat icon={Boxes} label="Units in stock" value={data.inventory.totalUnits} note={`${data.inventory.lowStockVariants} variants at 5 or fewer`} />
        <Stat icon={Users} label="Customers" value={data.customers} />
      </div>
      <p className="mt-6 text-sm text-muted">Orders and sales reporting will appear here once checkout is released.</p>
    </div>
  );
}

export function AdminInventory() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-inventory'], queryFn: adminService.inventory });
  return (
    <div>
      <h1 className="font-sans text-2xl font-semibold">Inventory</h1>
      <p className="mt-1 text-sm text-muted">Lowest stock first. Edit stock from a product&rsquo;s variants.</p>
      <div className="mt-6">
        {isLoading && <Spinner />}
        {isError && <ErrorMessage message="Could not load inventory." onRetry={refetch} />}
        {data && !data.length && <EmptyState icon={Boxes} title="No variants yet" text="Add variants to a product to track its stock." />}
        {data?.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-line bg-sand text-xs uppercase tracking-wide text-muted"><tr><th className="p-3">Product</th><th className="p-3">SKU</th><th className="p-3">Variant</th><th className="p-3 text-right">Stock</th></tr></thead>
              <tbody className="divide-y divide-line">
                {data.map((r) => (
                  <tr key={r.id}>
                    <td className="p-3 font-medium">{r.productName}</td><td className="p-3 text-muted">{r.sku}</td>
                    <td className="p-3">{[r.size, r.colorName].filter(Boolean).join(' / ') || '—'}</td>
                    <td className={`p-3 text-right font-medium ${r.stockQuantity <= 5 ? 'text-red-600' : ''}`}>{r.stockQuantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function AdminCustomers() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-customers'], queryFn: adminService.customers });
  return (
    <div>
      <h1 className="font-sans text-2xl font-semibold">Customers</h1>
      <div className="mt-6">
        {isLoading && <Spinner />}
        {isError && <ErrorMessage message="Could not load customers." onRetry={refetch} />}
        {data && !data.length && <EmptyState icon={Users} title="No customers yet" text="Registered customers will appear here." />}
        {data?.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-line bg-sand text-xs uppercase tracking-wide text-muted"><tr><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Phone</th><th className="p-3">Joined</th></tr></thead>
              <tbody className="divide-y divide-line">
                {data.map((u) => (
                  <tr key={u.id}><td className="p-3 font-medium">{u.fullName}</td><td className="p-3 text-muted">{u.email}</td><td className="p-3 text-muted">{u.phone || '—'}</td><td className="p-3 text-muted">{formatDate(u.createdAt)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function AdminCategories() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-categories'], queryFn: adminService.categories });
  const [editing, setEditing] = useState(null); // null | {} (new) | category
  const [toDelete, setToDelete] = useState(null);
  const [err, setErr] = useState({ message: '', fields: {} });

  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-categories'] }); qc.invalidateQueries({ queryKey: ['categories'] }); qc.invalidateQueries({ queryKey: ['admin-stats'] }); };
  const save = useMutation({
    mutationFn: (b) => (editing?.id ? adminService.updateCategory(editing.id, b) : adminService.createCategory(b)),
    onSuccess: () => { setEditing(null); refresh(); },
    onError: (e) => setErr(parseError(e)),
  });
  const del = useMutation({
    mutationFn: (id) => adminService.deleteCategory(id),
    onSuccess: () => { setToDelete(null); refresh(); },
    onError: (e) => { setErr({ message: parseError(e).message, fields: {} }); setToDelete(null); },
  });

  const submit = (e) => {
    e.preventDefault();
    setErr({ message: '', fields: {} });
    const f = new FormData(e.currentTarget);
    save.mutate({ name: f.get('name'), description: f.get('description') || null, sortOrder: Number(f.get('sortOrder') || 0) });
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-sans text-2xl font-semibold">Categories</h1>
        {!editing && <Button size="sm" onClick={() => { setErr({ message: '', fields: {} }); setEditing({}); }}>New category</Button>}
      </div>
      {err.message && !editing && <div className="mt-4"><Notice type="error">{err.message}</Notice></div>}

      {editing && (
        <form onSubmit={submit} className="card mt-6 max-w-xl space-y-4 p-5" noValidate>
          <h2 className="font-sans text-base font-semibold">{editing.id ? 'Edit category' : 'New category'}</h2>
          {err.message && <Notice type="error">{err.message}</Notice>}
          <FormField label="Name" name="name" defaultValue={editing.name} required error={err.fields.name} />
          <FormField label="Description" name="description" defaultValue={editing.description || ''} error={err.fields.description} />
          <FormField label="Sort order" name="sortOrder" type="number" min="0" defaultValue={editing.sortOrder ?? 0} />
          <div className="flex gap-3"><Button type="submit" loading={save.isPending}>Save</Button><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button></div>
        </form>
      )}

      <div className="mt-6">
        {isLoading && <Spinner />}
        {isError && <ErrorMessage message="Could not load categories." onRetry={refetch} />}
        {data && !data.length && !editing && <EmptyState icon={Tags} title="No categories" text="Create categories to organise your catalogue." />}
        {data?.length > 0 && (
          <ul className="card divide-y divide-line">
            {data.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0"><p className="truncate font-medium">{c.name}</p><p className="truncate text-xs text-muted">{c.slug} · {c.productCount} active products</p></div>
                <div className="flex shrink-0">
                  <button onClick={() => { setErr({ message: '', fields: {} }); setEditing(c); }} aria-label={`Edit ${c.name}`} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-sand"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => setToDelete(c)} aria-label={`Delete ${c.name}`} className="flex h-10 w-10 items-center justify-center rounded-full text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog open={!!toDelete} title="Delete category?" loading={del.isPending}
        message={toDelete ? `“${toDelete.name}” will be removed. Its products are kept and become uncategorised.` : ''}
        onConfirm={() => del.mutate(toDelete.id)} onCancel={() => setToDelete(null)} />
    </div>
  );
}

export function AdminSettings() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-settings'], queryFn: adminService.settings });
  const [err, setErr] = useState({ message: '', fields: {} });
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: adminService.saveSettings,
    onSuccess: () => { setSaved(true); qc.invalidateQueries({ queryKey: ['store-info'] }); qc.invalidateQueries({ queryKey: ['admin-settings'] }); },
    onError: (e) => setErr(parseError(e)),
  });
  if (isLoading) return <Spinner />;
  if (isError) return <ErrorMessage message="Could not load settings." onRetry={refetch} />;

  const submit = (e) => {
    e.preventDefault();
    setErr({ message: '', fields: {} }); setSaved(false);
    const f = new FormData(e.currentTarget);
    save.mutate(Object.fromEntries(['store_name', 'contact_email', 'contact_phone', 'contact_address', 'currency'].map((k) => [k, f.get(k) ?? ''])));
  };

  return (
    <div className="max-w-xl">
      <h1 className="font-sans text-2xl font-semibold">Store settings</h1>
      <form onSubmit={submit} className="card mt-6 space-y-4 p-5 sm:p-6" noValidate>
        {saved && <Notice>Settings saved.</Notice>}
        {err.message && <Notice type="error">{err.message}</Notice>}
        <FormField label="Store name" name="store_name" defaultValue={data.store_name} error={err.fields.store_name} />
        <FormField label="Contact email" name="contact_email" type="email" defaultValue={data.contact_email} error={err.fields.contact_email} />
        <FormField label="Contact phone" name="contact_phone" defaultValue={data.contact_phone} error={err.fields.contact_phone} />
        <FormField label="Address" name="contact_address" defaultValue={data.contact_address} error={err.fields.contact_address} />
        <FormField label="Currency code" name="currency" defaultValue={data.currency || 'INR'} maxLength={3} hint="3-letter ISO code, e.g. INR, USD" error={err.fields.currency} />
        <Button type="submit" loading={save.isPending}>Save settings</Button>
      </form>
    </div>
  );
}
