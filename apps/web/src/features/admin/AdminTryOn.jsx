import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, RefreshCw, Sparkles, Trash2, Upload } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import FormField from '../../components/ui/FormField.jsx';
import ProductImage from '../../components/ImagePlaceholder.jsx';
import { EmptyState, ErrorMessage, Notice, Spinner } from '../../components/ui/Feedback.jsx';
import { adminTryOnService } from '../../services/tryon.service.js';
import { parseError } from '../../services/api.js';

const STATUS_STYLE = { active: 'bg-green-100 text-green-800', draft: 'bg-amber-100 text-amber-800', archived: 'bg-gray-200 text-gray-700' };
const fmtMb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const errorText = (e) => {
  const { message, fields } = parseError(e);
  const extra = Object.values(fields || {}).filter(Boolean);
  return extra.length ? `${message}: ${extra.join('; ')}` : message;
};

function Stat({ label, value }) {
  return <div className="rounded-xl bg-sand p-3"><p className="text-xs text-muted">{label}</p><p className="text-lg font-semibold">{value}</p></div>;
}

function ProviderPanel() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-tryon-overview'], queryFn: adminTryOnService.overview });
  const credits = useMutation({ mutationFn: adminTryOnService.credits });
  if (isLoading) return <Spinner />;
  if (isError) return <ErrorMessage message="Could not load the try-on status." onRetry={refetch} />;
  const { provider: p, limits, last30Days: s } = data;
  return (
    <section className="card p-5" aria-labelledby="prov-h">
      <h2 id="prov-h" className="font-sans text-base font-semibold">AI provider: {p.label}</h2>
      {p.configured
        ? <p className="mt-1 text-sm text-leaf">Configured. The API key is stored on the server only.</p>
        : <div className="mt-2"><Notice type="error">Not configured: {p.configIssue}. Customers see virtual try-on as unavailable. Add the value to <code>apps/api/.env</code> and restart the API.</Notice></div>}
      {p.testMode && <div className="mt-3"><Notice type="error"><strong>Test mode is ON.</strong> Results are the customer's own photo, not AI output. Set GENLOOK_TEST_MODE=false for real results.</Notice></div>}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Try-ons (30 days)" value={s.total} />
        <Stat label="Completed" value={s.byStatus.completed} />
        <Stat label="Failed" value={s.byStatus.failed} />
        <Stat label="Test-mode runs" value={s.testSessions} />
      </div>
      <p className="mt-3 text-xs text-muted">Limits per customer/day: {limits.userDailyLimit || 'none'} · store-wide/day: {limits.storeDailyCap || 'none'} (set in <code>.env</code>).</p>
      {s.topFailures.length > 0 && (
        <div className="mt-3 text-xs text-muted"><p className="font-medium text-ink">Most common failures</p>
          <ul>{s.topFailures.map((f) => <li key={`${f.errorCode}-${f.providerErrorCode}`}>{f.count}× {f.errorCode}{f.providerErrorCode ? ` (${f.providerErrorCode})` : ''}</li>)}</ul></div>
      )}
      {p.supportsCredits && p.configured && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" loading={credits.isPending} onClick={() => credits.mutate()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Check credit balance</Button>
          {credits.isSuccess && <span className="text-sm">Credits remaining: <strong>{credits.data.balance ?? 'unknown'}</strong></span>}
          {credits.isError && <span className="text-sm text-red-600">{parseError(credits.error).message}</span>}
        </div>
      )}
    </section>
  );
}

/** /admin/try-on — provider status and every product's try-on readiness. */
export function AdminTryOnList() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-tryon-products'], queryFn: adminTryOnService.products });
  return (
    <div>
      <h1 className="font-sans text-2xl font-semibold">Virtual try-on</h1>
      <p className="mt-1 text-sm text-muted">Choose which products offer AI photo try-on. Each needs at least one clear garment photo (not the 3D model).</p>
      <div className="mt-6"><ProviderPanel /></div>
      <div className="mt-6">
        {isLoading && <Spinner />}
        {isError && <ErrorMessage message="Could not load products." onRetry={refetch} />}
        {data && !data.length && <EmptyState icon={Sparkles} title="No products yet" text="Create a product first." action={<Button to="/admin/products/new" size="sm">New product</Button>} />}
        {data?.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-line bg-sand text-xs uppercase tracking-wide text-muted">
                <tr><th className="p-3">Product</th><th className="p-3">Status</th><th className="p-3">Garment photos</th><th className="p-3">Try-on</th><th className="p-3 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((p) => (
                  <tr key={p.productId}>
                    <td className="p-3"><div className="flex items-center gap-3"><div className="w-10 shrink-0"><ProductImage src={p.primaryImage} ratio="aspect-square" className="rounded-lg" /></div><span className="font-medium">{p.name}</span></div></td>
                    <td className="p-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[p.status]}`}>{p.status}</span></td>
                    <td className="p-3 text-muted">{p.imageCount}</td>
                    <td className="p-3">{p.eligible ? <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800">Available</span>
                      : <span className="rounded-full bg-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700">{p.enabled ? 'Enabled (not live)' : 'Off'}</span>}</td>
                    <td className="p-3 text-right"><Button to={`/admin/try-on/${p.productId}`} size="sm" variant={p.imageCount ? 'outline' : 'primary'}>{p.imageCount ? 'Manage' : 'Add photos'}</Button></td>
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

/** /admin/try-on/:productId — garment photos and eligibility of one product. */
export function AdminTryOnManage() {
  const { productId } = useParams();
  const qc = useQueryClient();
  const addRef = useRef(null);
  const replaceRef = useRef(null);
  const [replaceId, setReplaceId] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState(null); // { enabled, aiDescription } once edited

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-tryon-product', productId], queryFn: () => adminTryOnService.product(productId) });
  const done = (msg) => (d) => {
    qc.setQueryData(['admin-tryon-product', productId], d);
    qc.invalidateQueries({ queryKey: ['admin-tryon-products'] });
    qc.invalidateQueries({ queryKey: ['product'] });
    setForm(null);
    setNotice({ type: 'success', text: d.autoDisabled ? 'Photo removed. Virtual try-on was switched off because no garment photo is left.' : msg });
  };
  const fail = (e) => setNotice({ type: 'error', text: errorText(e) });

  const add = useMutation({ mutationFn: (f) => adminTryOnService.addImage(productId, f), onSuccess: done('Garment photo added.'), onError: fail });
  const replace = useMutation({ mutationFn: ({ id, f }) => adminTryOnService.replaceImage(productId, id, f), onSuccess: done('Garment photo replaced.'), onError: fail });
  const remove = useMutation({ mutationFn: (id) => adminTryOnService.removeImage(productId, id), onSuccess: (d) => { setToDelete(null); done('Garment photo removed.')(d); }, onError: (e) => { setToDelete(null); fail(e); } });
  const saveCfg = useMutation({ mutationFn: (body) => adminTryOnService.saveConfig(productId, body), onSuccess: done('Settings saved.'), onError: fail });

  if (isLoading) return <Spinner />;
  if (isError) return <ErrorMessage message="Could not load this product." onRetry={refetch} />;

  const { product, config, images, limits, eligible } = data;
  const state = form ?? { enabled: config.enabled, aiDescription: config.aiDescription || '' };
  const busy = add.isPending || replace.isPending || remove.isPending;

  return (
    <div>
      <Link to="/admin/try-on" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Virtual try-on</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-sans text-2xl font-semibold">{product.name}</h1>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${eligible ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}>{eligible ? 'Available to customers' : 'Not available to customers'}</span>
      </div>
      {product.status !== 'active' && <div className="mt-3"><Notice type="error">This product is “{product.status}”. Customers cannot see it, so try-on stays unavailable until it is active.</Notice></div>}
      {notice && <div className="mt-4"><Notice type={notice.type}>{notice.text}</Notice></div>}

      <section className="card mt-6 p-5" aria-labelledby="gp-h">
        <h2 id="gp-h" className="font-sans text-base font-semibold">Garment photos ({images.length}/{limits.maxImages})</h2>
        <p className="mt-1 text-sm text-muted">AI try-on needs ordinary photos of the garment, not a 3D model. Best: front view on a plain background (flat-lay or on a model) with the whole garment visible; add a back view if you have one. JPEG, PNG or WebP, shorter side at least {limits.minSide}px, up to {fmtMb(limits.maxBytes)}. These files are private and are only sent to the AI provider when a customer requests a try-on.</p>
        {!images.length ? <p className="mt-4 text-sm text-muted">No garment photos yet.</p> : (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((img) => (
              <li key={img.id} className="rounded-xl border border-line p-2">
                <ProductImage src={img.url} alt={`Garment photo ${img.originalName}`} ratio="aspect-[4/5]" className="rounded-lg" />
                <p className="mt-2 truncate text-xs text-muted" title={img.originalName}>{img.originalName}</p>
                <p className="text-xs text-muted">{img.width}×{img.height} · {fmtMb(img.sizeBytes)}</p>
                <div className="mt-2 flex gap-1">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => { setReplaceId(img.id); replaceRef.current?.click(); }}><Upload className="h-3.5 w-3.5" aria-hidden="true" />Replace</Button>
                  <button disabled={busy} onClick={() => setToDelete(img)} aria-label={`Delete ${img.originalName}`} className="flex h-9 w-9 items-center justify-center rounded-full text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {images.length < limits.maxImages && (
          <Button className="mt-4" size="sm" loading={add.isPending} disabled={busy} onClick={() => addRef.current?.click()}><Plus className="h-4 w-4" aria-hidden="true" />Add garment photo</Button>
        )}
        <input ref={addRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Add garment photo"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) add.mutate(f); }} />
        <input ref={replaceRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Replace garment photo"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f && replaceId) replace.mutate({ id: replaceId, f }); }} />
      </section>

      <section className="card mt-6 p-5" aria-labelledby="set-h">
        <h2 id="set-h" className="font-sans text-base font-semibold">Settings</h2>
        <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" checked={state.enabled} onChange={(e) => setForm({ ...state, enabled: e.target.checked })} className="mt-0.5 h-5 w-5 accent-[#7952A3]" />
          <span><span className="font-medium">Offer virtual try-on for this product</span><br /><span className="text-muted">Requires at least one garment photo and an active product. Each customer try-on uses one provider credit.</span></span>
        </label>
        <FormField className="mt-4" as="textarea" rows={3} maxLength={500} label="Description for the AI (optional)" value={state.aiDescription}
          hint="Cut, length and fit help the AI, e.g. “Relaxed-fit linen shirt, long sleeves, hip length.” Leave blank to use the product description."
          onChange={(e) => setForm({ ...state, aiDescription: e.target.value })} />
        <Button className="mt-4" size="sm" loading={saveCfg.isPending} disabled={!form} onClick={() => saveCfg.mutate({ enabled: state.enabled, aiDescription: state.aiDescription || null })}>Save settings</Button>
      </section>

      <ConfirmDialog open={!!toDelete} title="Delete this garment photo?" message={toDelete ? `“${toDelete.originalName}” will be removed. If it was the last photo, virtual try-on is switched off for this product.` : ''}
        loading={remove.isPending} onConfirm={() => remove.mutate(toDelete.id)} onCancel={() => setToDelete(null)} />
    </div>
  );
}
