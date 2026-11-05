import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import FormField from '../../components/ui/FormField.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import ProductImage from '../../components/ImagePlaceholder.jsx';
import { EmptyState, ErrorMessage, Notice, Spinner } from '../../components/ui/Feedback.jsx';
import { adminService } from '../../services/store.service.js';
import { parseError } from '../../services/api.js';
import { formatPrice } from '../../utils/format.js';

const STATUS_STYLE = { active: 'bg-green-100 text-green-800', draft: 'bg-amber-100 text-amber-800', archived: 'bg-gray-200 text-gray-700' };

export function AdminProductList() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState(null);
  const [error, setError] = useState('');
  const params = { status: status || undefined, q: q || undefined, page, limit: 15 };
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-products', params], queryFn: () => adminService.products(params) });
  const del = useMutation({
    mutationFn: (id) => adminService.deleteProduct(id),
    onSuccess: () => { setToDelete(null); qc.invalidateQueries({ queryKey: ['admin-products'] }); qc.invalidateQueries({ queryKey: ['admin-stats'] }); },
    onError: (e) => { setError(parseError(e).message); setToDelete(null); },
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-sans text-2xl font-semibold">Products</h1>
        <Button to="/admin/products/new" size="sm"><Plus className="h-4 w-4" aria-hidden="true" />New product</Button>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input aria-label="Search products" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search by name"
          className="h-11 flex-1 rounded-xl border border-line bg-white px-4 text-sm focus:border-brand focus:outline-none" />
        <select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-11 rounded-xl border border-line bg-white px-3 text-sm">
          <option value="">All statuses</option><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option>
        </select>
      </div>
      {error && <div className="mt-4"><Notice type="error">{error}</Notice></div>}

      <div className="mt-6">
        {isLoading && <Spinner />}
        {isError && <ErrorMessage message="Could not load products." onRetry={refetch} />}
        {data && !data.items.length && <EmptyState title="No products" text="Create your first product to see it here." action={<Button to="/admin/products/new" size="sm">New product</Button>} />}
        {data?.items.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-line bg-sand text-xs uppercase tracking-wide text-muted">
                <tr><th className="p-3">Product</th><th className="p-3">Category</th><th className="p-3">Price</th><th className="p-3">Stock</th><th className="p-3">Status</th><th className="p-3 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((p) => (
                  <tr key={p.id}>
                    <td className="p-3"><div className="flex items-center gap-3"><div className="w-10 shrink-0"><ProductImage src={p.primaryImage} ratio="aspect-square" className="rounded-lg" /></div><span className="font-medium">{p.name}</span></div></td>
                    <td className="p-3 text-muted">{p.categoryName || '—'}</td>
                    <td className="p-3">{formatPrice(p.price)}</td>
                    <td className="p-3">{p.totalStock}</td>
                    <td className="p-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[p.status]}`}>{p.status}</span></td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <Link to={`/admin/products/${p.id}`} aria-label={`Edit ${p.name}`} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-sand"><Pencil className="h-4 w-4" /></Link>
                        <button onClick={() => setToDelete(p)} aria-label={`Delete ${p.name}`} className="flex h-10 w-10 items-center justify-center rounded-full text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.pagination.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3 text-sm">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-10 rounded-full border border-line bg-white px-4 disabled:opacity-40">Previous</button>
            <span className="text-muted">Page {page} of {data.pagination.totalPages}</span>
            <button disabled={page >= data.pagination.totalPages} onClick={() => setPage(page + 1)} className="h-10 rounded-full border border-line bg-white px-4 disabled:opacity-40">Next</button>
          </div>
        )}
      </div>

      <ConfirmDialog open={!!toDelete} title="Delete product?" loading={del.isPending}
        message={toDelete ? `“${toDelete.name}” and its variants and images will be permanently removed. This cannot be undone.` : ''}
        onConfirm={() => del.mutate(toDelete.id)} onCancel={() => setToDelete(null)} />
    </div>
  );
}

const emptyVariant = () => ({ sku: '', size: '', colorName: '', colorHex: '', stockQuantity: '0' });

function ProductForm({ initial, onSubmit, saving, error, fieldErrors, categories }) {
  const [images, setImages] = useState(initial?.images?.map((i) => ({ url: i.url, altText: i.altText || '' })) || []);
  const [variants, setVariants] = useState(initial?.variants?.length
    ? initial.variants.map((v) => ({ sku: v.sku, size: v.size || '', colorName: v.colorName || '', colorHex: v.colorHex || '', stockQuantity: String(v.stockQuantity) }))
    : []);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');

  const upload = async (file) => {
    if (!file) return;
    setUploadErr(''); setUploading(true);
    try {
      const url = await adminService.uploadImage(file);
      setImages((arr) => [...arr, { url, altText: '' }]);
    } catch (e) { setUploadErr(parseError(e).message); } finally { setUploading(false); }
  };

  const setVar = (i, key, val) => setVariants((arr) => arr.map((v, idx) => (idx === i ? { ...v, [key]: val } : v)));

  const submit = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k) => (f.get(k) === '' || f.get(k) == null ? null : Number(f.get(k)));
    onSubmit({
      name: f.get('name'),
      description: f.get('description') || null,
      price: Number(f.get('price')),
      compareAtPrice: num('compareAtPrice'),
      categoryId: f.get('categoryId') ? Number(f.get('categoryId')) : null,
      status: f.get('status'),
      isFeatured: f.get('isFeatured') === 'on',
      images: images.map((i) => ({ url: i.url, altText: i.altText || null })),
      variants: variants.map((v) => ({
        sku: v.sku, size: v.size || null, colorName: v.colorName || null,
        colorHex: v.colorHex || null, stockQuantity: Number(v.stockQuantity || 0),
      })),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {error && <Notice type="error">{error}</Notice>}
      <section className="card space-y-4 p-5 sm:p-6">
        <h2 className="font-sans text-base font-semibold">Details</h2>
        <FormField label="Name" name="name" defaultValue={initial?.name} required error={fieldErrors.name} />
        <FormField as="textarea" rows={5} label="Description" name="description" defaultValue={initial?.description || ''} error={fieldErrors.description} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Price" name="price" type="number" step="0.01" min="0" defaultValue={initial?.price} required error={fieldErrors.price} />
          <FormField label="Compare-at price (optional)" name="compareAtPrice" type="number" step="0.01" min="0" defaultValue={initial?.compareAtPrice ?? ''} error={fieldErrors.compareAtPrice} />
          <FormField as="select" label="Category" name="categoryId" defaultValue={initial?.categoryId ?? ''} error={fieldErrors.categoryId}>
            <option value="">Uncategorised</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormField>
          <FormField as="select" label="Status" name="status" defaultValue={initial?.status || 'active'}>
            <option value="active">Active (visible in store)</option><option value="draft">Draft (hidden)</option><option value="archived">Archived (hidden)</option>
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isFeatured" defaultChecked={initial?.isFeatured} className="h-4 w-4" />Feature on the home page</label>
      </section>

      <section className="card space-y-4 p-5 sm:p-6">
        <h2 className="font-sans text-base font-semibold">Images</h2>
        {uploadErr && <Notice type="error">{uploadErr}</Notice>}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {images.map((img, i) => (
            <div key={img.url + i} className="relative">
              <ProductImage src={img.url} alt={`Product image ${i + 1}`} ratio="aspect-square" className="rounded-xl" />
              <button type="button" onClick={() => setImages((a) => a.filter((_, x) => x !== i))} aria-label={`Remove image ${i + 1}`}
                className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow"><X className="h-4 w-4" /></button>
              {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-white/90 px-1.5 text-[10px]">Main</span>}
            </div>
          ))}
          {images.length < 10 && (
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line text-xs text-muted hover:bg-sand">
              <Upload className="h-5 w-5" aria-hidden="true" />{uploading ? 'Uploading…' : 'Upload'}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading}
                onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          )}
        </div>
        <p className="text-xs text-muted">JPEG, PNG or WebP. The first image is the main image.</p>
      </section>

      <section className="card space-y-4 p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-sans text-base font-semibold">Variants &amp; stock</h2>
          <Button size="sm" variant="outline" onClick={() => setVariants((v) => [...v, emptyVariant()])}><Plus className="h-4 w-4" aria-hidden="true" />Add variant</Button>
        </div>
        {fieldErrors.variants && <Notice type="error">{fieldErrors.variants}</Notice>}
        {variants.length === 0 && <p className="text-sm text-muted">No variants. Add sizes and colours to track stock.</p>}
        {variants.map((v, i) => (
          <div key={i} className="grid grid-cols-2 gap-3 rounded-xl border border-line p-3 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto]">
            <FormField label="SKU" value={v.sku} onChange={(e) => setVar(i, 'sku', e.target.value)} required />
            <FormField label="Size" value={v.size} onChange={(e) => setVar(i, 'size', e.target.value)} />
            <FormField label="Colour name" value={v.colorName} onChange={(e) => setVar(i, 'colorName', e.target.value)} />
            <FormField label="Colour" type="color" value={v.colorHex || '#000000'} onChange={(e) => setVar(i, 'colorHex', e.target.value)} className="[&_input]:p-1" />
            <FormField label="Stock" type="number" min="0" value={v.stockQuantity} onChange={(e) => setVar(i, 'stockQuantity', e.target.value)} />
            <button type="button" onClick={() => setVariants((a) => a.filter((_, x) => x !== i))} aria-label={`Remove variant ${i + 1}`}
              className="col-span-2 flex h-11 items-center justify-center gap-1 self-end rounded-xl text-sm text-red-600 hover:bg-red-50 md:col-span-1 md:w-11"><Trash2 className="h-4 w-4" /><span className="md:hidden">Remove</span></button>
          </div>
        ))}
      </section>

      <div className="flex gap-3">
        <Button type="submit" loading={saving}>Save product</Button>
        <Button to="/admin/products" variant="outline">Cancel</Button>
      </div>
    </form>
  );
}

export function AdminProductEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [err, setErr] = useState({ message: '', fields: {} });
  const { data: categories = [] } = useQuery({ queryKey: ['admin-categories'], queryFn: adminService.categories });
  const { data: product, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-product', id], queryFn: () => adminService.product(id), enabled: !isNew,
  });
  const save = useMutation({
    mutationFn: (body) => (isNew ? adminService.createProduct(body) : adminService.updateProduct(id, body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      qc.invalidateQueries({ queryKey: ['admin-product'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      navigate('/admin/products');
    },
    onError: (e) => { setErr(parseError(e)); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  });

  if (!isNew && isLoading) return <Spinner />;
  if (!isNew && isError) return <ErrorMessage message="Could not load this product." onRetry={refetch} />;

  const fieldMsg = Object.keys(err.fields).length ? `${err.message}: ${Object.entries(err.fields).map(([k, v]) => `${k} — ${v}`).join('; ')}` : err.message;

  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 font-sans text-2xl font-semibold">{isNew ? 'New product' : 'Edit product'}</h1>
      <ProductForm key={product?.id || 'new'} initial={product} categories={categories} saving={save.isPending}
        error={fieldMsg} fieldErrors={err.fields} onSubmit={(b) => { setErr({ message: '', fields: {} }); save.mutate(b); }} />
    </div>
  );
}
