import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ScanFace, Trash2, Upload } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import ProductImage from '../../components/ImagePlaceholder.jsx';
import { EmptyState, ErrorMessage, Notice, Spinner } from '../../components/ui/Feedback.jsx';
import { adminArService } from '../../services/ar.service.js';
import { parseError } from '../../services/api.js';

const STATUS_STYLE = { active: 'bg-green-100 text-green-800', draft: 'bg-amber-100 text-amber-800', archived: 'bg-gray-200 text-gray-700' };
const GARMENT_TYPES = [
  { key: 'top', label: 'Top (t-shirt, shirt, sweater)', hint: 'Fitted to the shoulders and torso.' },
  { key: 'outerwear', label: 'Outerwear (jacket, coat)', hint: 'Wider and longer than a top.' },
];
const errorText = (e) => {
  const { message, fields } = parseError(e);
  const extra = Object.values(fields || {}).filter(Boolean);
  return extra.length ? `${message}: ${extra.join('; ')}` : message;
};

/** /admin/ar — which products offer real-time AR try-on. */
export function AdminArList() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-ar-products'], queryFn: adminArService.list });
  if (isLoading) return <Spinner />;
  if (isError) return <ErrorMessage message="Could not load products." onRetry={refetch} />;
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Real-time AR try-on</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">Choose which products offer a live camera preview. The garment follows the customer’s shoulders using their device camera; nothing is sent to an AI provider. It needs either the product’s 3D model (3D assets) or a transparent garment image.</p>
      {!data.length ? <div className="mt-6"><EmptyState title="No products yet" /></div> : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => (
            <li key={p.productId} className="card flex items-center gap-3 p-3">
              <ProductImage src={p.primaryImage} alt="" ratio="aspect-square" className="h-16 w-16 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.name}</p>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                  <span className={`rounded-full px-2 py-0.5 ${STATUS_STYLE[p.status]}`}>{p.status}</span>
                  <span className={`rounded-full px-2 py-0.5 ${p.eligible ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}>{p.eligible ? 'AR live' : p.enabled ? 'Enabled, not live' : 'Off'}</span>
                </div>
              </div>
              <Button to={`/admin/ar/${p.productId}`} size="sm" variant="outline">Manage</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OverlayPreview({ productId, version }) {
  const { data, isError } = useQuery({ queryKey: ['admin-ar-overlay', productId, version], queryFn: () => adminArService.overlayBlob(productId), retry: false });
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!data) return undefined;
    const u = URL.createObjectURL(data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data]);
  if (isError) return <p className="text-sm text-red-600">Preview could not be loaded.</p>;
  // Checkerboard shows transparency exactly as the customer will see the garment over their camera.
  return (
    <div className="flex max-h-72 items-center justify-center overflow-hidden rounded-xl border border-line"
      style={{ backgroundImage: 'conic-gradient(#e5e5e5 25%, #fff 0 50%, #e5e5e5 0 75%, #fff 0)', backgroundSize: '16px 16px' }}>
      {url ? <img src={url} alt="Garment overlay preview" className="max-h-72 w-auto max-w-full object-contain" /> : <Spinner className="py-10" />}
    </div>
  );
}

/** /admin/ar/:productId */
export function AdminArManage() {
  const { productId } = useParams();
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-ar-product', productId], queryFn: () => adminArService.get(productId) });
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => { if (data) setForm(data.config); }, [data]);

  const done = (next, text) => {
    qc.setQueryData(['admin-ar-product', productId], next);
    qc.invalidateQueries({ queryKey: ['admin-ar-products'] });
    qc.invalidateQueries({ queryKey: ['product'] });
    if (text) setMsg({ type: 'success', text });
  };
  const fail = (e) => setMsg({ type: 'error', text: errorText(e) });

  const save = useMutation({ mutationFn: () => adminArService.save(productId, form), onSuccess: (d) => done(d, 'Settings saved.'), onError: fail });
  const upload = useMutation({
    mutationFn: (file) => adminArService.uploadOverlay(productId, file),
    onSuccess: (d) => { setVersion((v) => v + 1); done(d, 'Overlay uploaded.'); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => adminArService.removeOverlay(productId),
    onSuccess: (d) => { setConfirmRemove(false); setVersion((v) => v + 1); done(d, d.autoDisabled ? 'Overlay removed. AR was switched off for this product because it needs the overlay.' : 'Overlay removed.'); },
    onError: (e) => { setConfirmRemove(false); fail(e); },
  });

  if (isLoading || !form) return isError ? <ErrorMessage message="Could not load this product." onRetry={refetch} /> : <Spinner />;
  const p = data.product;
  const set = (patch) => { setMsg(null); setForm((f) => ({ ...f, ...patch })); };
  const dirty = JSON.stringify(form) !== JSON.stringify(data.config);
  const modeOk = form.assetMode === 'model3d' ? data.hasModel : !!data.overlay;

  return (
    <div className="max-w-3xl">
      <Link to="/admin/ar" className="mb-4 inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden="true" />All products</Link>
      <h1 className="font-display text-2xl font-semibold">{p.name}</h1>
      <p className="mt-1 text-sm text-muted">Status: {p.status}. {data.eligible ? 'Customers can use AR try-on for this product.' : 'Customers cannot use AR try-on yet (the product must be active, AR enabled, and the chosen asset uploaded).'}</p>
      {msg && <div className="mt-4"><Notice type={msg.type}>{msg.text}</Notice></div>}

      <section className="card mt-6 space-y-5 p-5">
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" className="h-5 w-5 accent-[#7952A3]" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Offer real-time AR try-on for this product
        </label>
        {form.enabled && !modeOk && <Notice type="error">{form.assetMode === 'model3d' ? 'This product has no 3D model yet. Upload one under 3D assets, or switch to a 2D overlay.' : 'Upload a transparent overlay image below before saving.'}</Notice>}

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Garment asset</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[{ k: 'model3d', t: '3D model (GLB/GLTF)', d: data.hasModel ? 'Uses this product’s 3D model. Customers can also change colour and style in AR.' : 'No 3D model uploaded yet.' },
              { k: 'overlay2d', t: '2D overlay image', d: data.overlay ? 'Uses the transparent image below. No colour options.' : 'No overlay uploaded yet.' }].map((o) => (
              <label key={o.k} className={`cursor-pointer rounded-xl border p-3 text-sm ${form.assetMode === o.k ? 'border-ink bg-sand' : 'border-line bg-white'}`}>
                <input type="radio" name="assetMode" className="sr-only" checked={form.assetMode === o.k} onChange={() => set({ assetMode: o.k })} />
                <span className="block font-medium">{o.t}</span><span className="text-muted">{o.d}</span>
              </label>
            ))}
          </div>
          {!data.hasModel && <Link to={`/admin/3d-assets/${p.id}`} className="mt-2 inline-block text-sm font-medium text-brand hover:underline">Go to 3D assets</Link>}
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Garment type (positioning)</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {GARMENT_TYPES.map((g) => (
              <label key={g.key} className={`cursor-pointer rounded-xl border p-3 text-sm ${form.garmentType === g.key ? 'border-ink bg-sand' : 'border-line bg-white'}`}>
                <input type="radio" name="garmentType" className="sr-only" checked={form.garmentType === g.key} onChange={() => set({ garmentType: g.key })} />
                <span className="block font-medium">{g.label}</span><span className="text-muted">{g.hint}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Only upper-body garments are supported in this release. Trousers, skirts, dresses and shoes need other tracking and are not offered.</p>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm"><span className="font-medium">Size adjustment: ×{Number(form.scaleAdjust).toFixed(2)}</span>
            <input type="range" min="0.5" max="1.6" step="0.01" value={form.scaleAdjust} onChange={(e) => set({ scaleAdjust: Number(e.target.value) })} className="mt-2 w-full" aria-label="Size adjustment" />
            <span className="text-xs text-muted">1.00 = default for the garment type. Calibrate per garment by testing it in AR.</span></label>
          <label className="block text-sm"><span className="font-medium">Vertical position: {form.offsetYAdjust > 0 ? '+' : ''}{Number(form.offsetYAdjust).toFixed(2)}</span>
            <input type="range" min="-0.3" max="0.3" step="0.01" value={form.offsetYAdjust} onChange={(e) => set({ offsetYAdjust: Number(e.target.value) })} className="mt-2 w-full" aria-label="Vertical position" />
            <span className="text-xs text-muted">Positive moves the garment down, negative up (fraction of torso height).</span></label>
        </div>

        <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>Save settings</Button>
      </section>

      <section className="card mt-6 space-y-4 p-5" aria-labelledby="ov-h">
        <h2 id="ov-h" className="font-sans text-base font-semibold">2D overlay image</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>PNG or WebP with a transparent background (cut-out garment, front view, no model or hanger).</li>
          <li>At least {data.limits.minSide}px on the short side, up to {data.limits.maxSide}px, max {data.limits.maxOverlayBytes / 1024 / 1024} MB.</li>
          <li>Straight-on, symmetrical and level. Include sleeves so the shoulder width matches the garment edge.</li>
        </ul>
        {data.overlay && <>
          <OverlayPreview productId={p.id} version={version} />
          <p className="text-xs text-muted">{data.overlay.name} · {data.overlay.width}×{data.overlay.height}px · {(data.overlay.sizeBytes / 1024).toFixed(0)} KB</p>
        </>}
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/webp" className="sr-only" aria-label="Choose overlay image"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setMsg(null); upload.mutate(f); } }} />
          <Button variant="outline" loading={upload.isPending} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />{data.overlay ? 'Replace overlay' : 'Upload overlay'}</Button>
          {data.overlay && <Button variant="danger" onClick={() => setConfirmRemove(true)}><Trash2 className="h-4 w-4" aria-hidden="true" />Remove</Button>}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-white p-5 text-sm text-muted">
        <h2 className="flex items-center gap-2 font-sans text-base font-semibold text-ink"><ScanFace className="h-4 w-4" aria-hidden="true" />What customers get, honestly</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>A rigid garment that follows the shoulders and torso (position, size, tilt, approximate turn). No cloth simulation, size prediction or realistic draping.</li>
          <li>The garment is drawn in front of the person, so arms are never shown in front of it.</li>
          <li>3D models should be upright, facing forward (+Z) and symmetrical. Test every garment on a real device and adjust the two sliders above.</li>
        </ul>
      </section>

      <ConfirmDialog open={confirmRemove} title="Remove the overlay image?" confirmLabel="Remove" message="The image is deleted. If AR uses the overlay for this product, it will be switched off."
        loading={remove.isPending} onConfirm={() => remove.mutate()} onCancel={() => setConfirmRemove(false)} />
    </div>
  );
}
