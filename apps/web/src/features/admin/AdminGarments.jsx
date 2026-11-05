import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useGLTF } from '@react-three/drei';
import { ArrowLeft, Box, Eye, Plus, Trash2, Upload } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import FormField from '../../components/ui/FormField.jsx';
import ProductImage from '../../components/ImagePlaceholder.jsx';
import { EmptyState, ErrorMessage, Notice, Spinner } from '../../components/ui/Feedback.jsx';
import GarmentViewer from '../garment-studio/GarmentViewer.jsx';
import { adminGarmentService } from '../../services/garment.service.js';
import { parseError } from '../../services/api.js';

const STATUS_STYLE = { active: 'bg-green-100 text-green-800', draft: 'bg-amber-100 text-amber-800', archived: 'bg-gray-200 text-gray-700' };
const fmtMb = (b) => `${(b / 1024 / 1024).toFixed(b > 1024 * 1024 * 10 ? 0 : 1)} MB`;

/** Error text including per-field details from the API. */
const errorText = (e) => {
  const { message, fields } = parseError(e);
  const extra = Object.values(fields || {}).filter(Boolean);
  return extra.length ? `${message}: ${extra.join('; ')}` : message;
};

/** /admin/3d-assets — every product with its 3D model status. */
export function AdminGarmentList() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-garments'], queryFn: adminGarmentService.list });
  return (
    <div>
      <h1 className="font-sans text-2xl font-semibold">3D assets</h1>
      <p className="mt-1 text-sm text-muted">Attach a GLB/GLTF model to a product to enable “Customize in 3D” in the storefront.</p>
      <div className="mt-6">
        {isLoading && <Spinner />}
        {isError && <ErrorMessage message="Could not load products." onRetry={refetch} />}
        {data && !data.items.length && <EmptyState icon={Box} title="No products yet" text="Create a product first, then add a 3D model to it." action={<Button to="/admin/products/new" size="sm">New product</Button>} />}
        {data?.items.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-line bg-sand text-xs uppercase tracking-wide text-muted">
                <tr><th className="p-3">Product</th><th className="p-3">Status</th><th className="p-3">3D model</th><th className="p-3">Style options</th><th className="p-3 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((p) => (
                  <tr key={p.productId}>
                    <td className="p-3"><div className="flex items-center gap-3"><div className="w-10 shrink-0"><ProductImage src={p.primaryImage} ratio="aspect-square" className="rounded-lg" /></div><span className="font-medium">{p.name}</span></div></td>
                    <td className="p-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[p.status]}`}>{p.status}</span></td>
                    <td className="p-3">{p.hasModel ? <span>{p.originalName} <span className="text-muted">({fmtMb(p.sizeBytes)})</span></span> : <span className="text-muted">None</span>}</td>
                    <td className="p-3 text-muted">{p.hasModel ? p.optionCount : '—'}</td>
                    <td className="p-3 text-right"><Button to={`/admin/3d-assets/${p.productId}`} size="sm" variant={p.hasModel ? 'outline' : 'primary'}>{p.hasModel ? 'Manage' : 'Add model'}</Button></td>
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

// ------------------------------------------------------------------ option editor helpers
const parseNodes = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const toKey = (label) => label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const toDraft = (options) => options.map((o) => ({
  key: o.key, label: o.label,
  values: o.values.map((v) => ({ key: v.key, label: v.label, show: v.show.join(', '), hide: v.hide.join(', ') })),
}));
const emptyValue = () => ({ key: null, label: '', show: '', hide: '' });

/** Keys of existing options/values are kept (saved designs reference them); new ones are derived from the label. */
function draftToPayload(draft) {
  const uniq = (base, taken, fallback) => {
    let k = base || fallback;
    let n = 2;
    while (taken.has(k)) { k = `${(base || fallback).slice(0, 36)}-${n}`; n += 1; }
    taken.add(k);
    return k;
  };
  const optionKeys = new Set(draft.filter((o) => o.key).map((o) => o.key));
  return draft.map((o, oi) => {
    const valueKeys = new Set(o.values.filter((v) => v.key).map((v) => v.key));
    return {
      key: o.key || uniq(toKey(o.label), optionKeys, `option-${oi + 1}`),
      label: o.label.trim(),
      values: o.values.map((v, vi) => ({
        key: v.key || uniq(toKey(v.label), valueKeys, `value-${vi + 1}`),
        label: v.label.trim(), show: parseNodes(v.show), hide: parseNodes(v.hide),
      })),
    };
  });
}

function UploadBox({ productId, limits, hasModel, onUploaded }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const upload = useMutation({
    mutationFn: () => adminGarmentService.uploadModel(productId, file, setProgress),
    onSuccess: (data) => { setFile(null); setError(''); setProgress(0); if (inputRef.current) inputRef.current.value = ''; onUploaded(data); },
    onError: (e) => { setError(errorText(e)); setProgress(0); },
  });
  const pick = (f) => {
    setError('');
    if (!f) return setFile(null);
    if (!/\.(glb|gltf)$/i.test(f.name)) { setFile(null); return setError('Choose a .glb or .gltf file.'); }
    if (f.size > limits.maxModelBytes) { setFile(null); return setError(`This file is ${fmtMb(f.size)}; the limit is ${fmtMb(limits.maxModelBytes)}.`); }
    return setFile(f);
  };
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium" htmlFor="model-file">{hasModel ? 'Replace model' : 'Upload 3D model'}</label>
      <input id="model-file" ref={inputRef} type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" onChange={(e) => pick(e.target.files?.[0])}
        className="block w-full max-w-md text-sm file:mr-3 file:h-10 file:rounded-full file:border file:border-line file:bg-white file:px-4 file:text-sm file:font-medium hover:file:bg-sand" />
      <p className="text-xs text-muted">GLB recommended (single self-contained file, up to {fmtMb(limits.maxModelBytes)}). Draco and KTX2 compression are not supported.</p>
      {file && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" loading={upload.isPending} onClick={() => upload.mutate()}><Upload className="h-4 w-4" aria-hidden="true" />{hasModel ? 'Upload and replace' : 'Upload'}</Button>
          <span className="text-sm text-muted">{file.name} ({fmtMb(file.size)})</span>
          {upload.isPending && <span className="text-sm" aria-live="polite">{progress}%</span>}
        </div>
      )}
      {error && <Notice type="error">{error}</Notice>}
    </div>
  );
}

function Workspace({ productId, asset, options, onData }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [selectedMats, setSelectedMats] = useState(asset.customizableMaterials);
  const [draft, setDraft] = useState(() => toDraft(options));
  const [previewSel, setPreviewSel] = useState({});
  const [testColor, setTestColor] = useState(null);
  const [info, setInfo] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Authenticated fetch -> blob URL, so drafts/archived products can be previewed without a public URL.
  useEffect(() => {
    let cancelled = false;
    let url = null;
    setPreviewUrl(null); setPreviewError('');
    adminGarmentService.modelBlob(productId)
      .then((b) => { if (!cancelled) { url = URL.createObjectURL(b); setPreviewUrl(url); } })
      .catch((e) => { if (!cancelled) setPreviewError(parseError(e).message); });
    return () => { cancelled = true; if (url) { URL.revokeObjectURL(url); useGLTF.clear(url); } };
  }, [productId, asset.id, asset.updatedAt]);

  const rules = useMemo(() => draft.map((o, i) => {
    const v = o.values[previewSel[i] ?? 0];
    return { show: v ? parseNodes(v.show) : [], hide: v ? parseNodes(v.hide) : [] };
  }), [draft, previewSel]);
  const look = useMemo(() => ({ colorHex: testColor, preset: null, materialNames: selectedMats }), [testColor, selectedMats]);

  const saveMats = useMutation({
    mutationFn: () => adminGarmentService.updateMaterials(productId, selectedMats),
    onSuccess: (d) => { onData(d); setErr(''); setMsg('Customizable materials saved.'); },
    onError: (e) => { setMsg(''); setErr(errorText(e)); },
  });
  const saveOpts = useMutation({
    mutationFn: () => adminGarmentService.saveOptions(productId, draftToPayload(draft)),
    onSuccess: (d) => { onData(d); setDraft(toDraft(d.options)); setPreviewSel({}); setErr(''); setMsg('Style options saved.'); },
    onError: (e) => { setMsg(''); setErr(errorText(e)); },
  });

  const mi = asset.modelInfo;
  const setOpt = (i, patch) => setDraft((d) => d.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  const setVal = (i, j, patch) => setDraft((d) => d.map((o, k) => (k === i ? { ...o, values: o.values.map((v, m) => (m === j ? { ...v, ...patch } : v)) } : o)));

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-3 font-sans text-base font-semibold">Preview</h2>
          <div className="h-[340px] sm:h-[420px]">
            {previewError ? <ErrorMessage message={previewError} /> : <GarmentViewer url={previewUrl} name="model preview" look={look} rules={rules} onInfo={setInfo} />}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">Test colour
              <input type="color" value={testColor || '#7952A3'} onChange={(e) => setTestColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-line bg-white" />
            </label>
            {testColor && <button className="text-muted underline" onClick={() => setTestColor(null)}>Clear</button>}
            {info && <span className="text-xs text-muted">{info.editable} of {info.total} materials editable with the current selection</span>}
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-4">
            <h2 className="font-sans text-base font-semibold">Model details</h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">File</dt><dd className="break-all">{asset.originalName}</dd>
              <dt className="text-muted">Format / size</dt><dd>{asset.format.toUpperCase()} · {fmtMb(asset.sizeBytes)}</dd>
              <dt className="text-muted">Triangles</dt><dd>{mi.triangleCount.toLocaleString()}</dd>
              <dt className="text-muted">Textures</dt><dd>{mi.textureCount}</dd>
              <dt className="text-muted">Uploaded</dt><dd>{new Date(asset.updatedAt).toLocaleString()}</dd>
            </dl>
            {mi.triangleCount > 300000 && <div className="mt-3"><Notice type="error">This model is heavy ({mi.triangleCount.toLocaleString()} triangles) and may be slow on phones. Consider simplifying it.</Notice></div>}
          </div>

          <div className="card p-4">
            <h2 className="font-sans text-base font-semibold">Materials customers can change</h2>
            <p className="mt-1 text-xs text-muted">Colour and finish apply only to the ticked materials. Tick none to apply to all materials.</p>
            {mi.materialNames.length === 0 ? <p className="mt-3 text-sm text-muted">This model has no named materials, so colour and finish apply to every material.</p> : (
              <div className="mt-3 space-y-1">
                {mi.materialNames.map((m) => (
                  <label key={m} className="flex min-h-[40px] items-center gap-3 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={selectedMats.includes(m)} onChange={(e) => setSelectedMats((s) => (e.target.checked ? [...s, m] : s.filter((x) => x !== m)))} />{m}
                  </label>
                ))}
                <Button size="sm" variant="outline" className="mt-2" loading={saveMats.isPending} onClick={() => saveMats.mutate()}>Save materials</Button>
              </div>
            )}
            {mi.unnamedMaterials > 0 && <p className="mt-2 text-xs text-muted">{mi.unnamedMaterials} unnamed material(s) cannot be targeted individually.</p>}
          </div>
        </div>
      </div>

      <div className="card mt-6 p-4 sm:p-6">
        <h2 className="font-sans text-base font-semibold">Style options (sleeves, neckline, length…)</h2>
        <p className="mt-1 text-sm text-muted">
          Each choice shows or hides named parts that already exist inside this model file. It cannot reshape the garment, so the
          model must contain every variant (for example <code>Sleeve_Short_L</code> and <code>Sleeve_Long_L</code>). The first value is the default.
        </p>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium">Node names in this model ({mi.nodeNames.length})</summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {mi.nodeNames.map((n) => <code key={n} className="rounded bg-sand px-2 py-0.5 text-xs">{n}</code>)}
            {!mi.nodeNames.length && <span className="text-muted">No named nodes. Name parts in your 3D tool to use style options.</span>}
          </div>
        </details>

        <div className="mt-5 space-y-5">
          {draft.map((o, i) => (
            <fieldset key={i} className="rounded-2xl border border-line p-4">
              <div className="flex items-end gap-2">
                <FormField label="Option name" className="flex-1" value={o.label} maxLength={60} placeholder="e.g. Sleeves" onChange={(e) => setOpt(i, { label: e.target.value })} />
                <button type="button" aria-label={`Remove option ${o.label || i + 1}`} onClick={() => { setDraft((d) => d.filter((_, k) => k !== i)); setPreviewSel({}); }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="mt-4 space-y-3">
                {o.values.map((v, j) => (
                  <div key={j} className={`rounded-xl p-3 ${(previewSel[i] ?? 0) === j ? 'bg-brand/5 ring-1 ring-brand/30' : 'bg-sand'}`}>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <FormField label={j === 0 ? 'Value (default)' : 'Value'} value={v.label} maxLength={60} placeholder="e.g. Long" onChange={(e) => setVal(i, j, { label: e.target.value })} />
                      <FormField label="Show nodes" value={v.show} placeholder="Sleeve_Long_L, Sleeve_Long_R" onChange={(e) => setVal(i, j, { show: e.target.value })} />
                      <FormField label="Hide nodes" value={v.hide} placeholder="Sleeve_Short_L, Sleeve_Short_R" onChange={(e) => setVal(i, j, { hide: e.target.value })} />
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setPreviewSel((s) => ({ ...s, [i]: j }))}><Eye className="h-4 w-4" aria-hidden="true" />Preview</Button>
                      {o.values.length > 2 && <button type="button" aria-label={`Remove value ${v.label || j + 1}`} onClick={() => { setOpt(i, { values: o.values.filter((_, m) => m !== j) }); setPreviewSel({}); }} className="flex h-9 w-9 items-center justify-center rounded-full text-red-600 hover:bg-red-100"><Trash2 className="h-4 w-4" /></button>}
                    </div>
                  </div>
                ))}
                {o.values.length < 12 && <Button size="sm" variant="ghost" onClick={() => setOpt(i, { values: [...o.values, emptyValue()] })}><Plus className="h-4 w-4" aria-hidden="true" />Add value</Button>}
              </div>
            </fieldset>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          {draft.length < 8 && <Button variant="outline" size="sm" onClick={() => setDraft((d) => [...d, { key: null, label: '', values: [emptyValue(), emptyValue()] }])}><Plus className="h-4 w-4" aria-hidden="true" />Add option</Button>}
          <Button size="sm" loading={saveOpts.isPending} onClick={() => saveOpts.mutate()}>Save style options</Button>
        </div>
        <p className="mt-2 text-xs text-muted">Saving with no options removes all style options for this product. Existing options keep their internal keys so customers&apos; saved designs stay valid.</p>
        <div className="mt-4 space-y-2" aria-live="polite">
          {msg && <Notice>{msg}</Notice>}
          {err && <Notice type="error">{err}</Notice>}
        </div>
      </div>
    </>
  );
}

/** /admin/3d-assets/:productId — upload, replace, remove, configure. */
export function AdminGarmentManage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-garment', productId], queryFn: () => adminGarmentService.get(productId), retry: false });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState('');

  const setData = (d) => {
    qc.setQueryData(['admin-garment', productId], { product: d.product, asset: d.asset, options: d.options, limits: d.limits });
    qc.invalidateQueries({ queryKey: ['admin-garments'] });
    qc.invalidateQueries({ queryKey: ['product'] });
  };
  const remove = useMutation({
    mutationFn: () => adminGarmentService.removeModel(productId),
    onSuccess: () => { setConfirmRemove(false); setWarnings([]); qc.invalidateQueries({ queryKey: ['admin-garment', productId] }); qc.invalidateQueries({ queryKey: ['admin-garments'] }); qc.invalidateQueries({ queryKey: ['product'] }); },
    onError: (e) => { setError(parseError(e).message); setConfirmRemove(false); },
  });

  if (q.isLoading) return <Spinner />;
  if (q.error?.response?.status === 404) return <EmptyState title="Product not found" action={<Button to="/admin/3d-assets" size="sm">Back to list</Button>} />;
  if (q.isError) return <ErrorMessage message="Could not load this product." onRetry={q.refetch} />;

  const { product, asset, options, limits } = q.data;
  return (
    <div>
      <button onClick={() => navigate('/admin/3d-assets')} className="mb-3 inline-flex min-h-[44px] items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden="true" />All 3D assets</button>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-sans text-2xl font-semibold">{product.name}</h1>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[product.status]}`}>{product.status}</span>
        <Link to={`/admin/products/${product.id}`} className="text-sm text-brand hover:underline">Edit product</Link>
      </div>
      {product.status !== 'active' && <div className="mt-3"><Notice type="error">This product is not active, so customers cannot see its 3D model yet. You can still preview it here.</Notice></div>}
      {error && <div className="mt-3"><Notice type="error">{error}</Notice></div>}
      {warnings.map((w) => <div key={w} className="mt-3"><Notice type="error">{w}</Notice></div>)}

      <div className="card mt-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-sans text-base font-semibold">{asset ? '3D model' : 'No 3D model yet'}</h2>
          {asset && <Button variant="danger" size="sm" onClick={() => setConfirmRemove(true)}><Trash2 className="h-4 w-4" aria-hidden="true" />Remove model</Button>}
        </div>
        <div className="mt-4">
          <UploadBox productId={productId} limits={limits} hasModel={!!asset} onUploaded={(d) => { setData(d); setWarnings(d.warnings || []); setError(''); }} />
        </div>
      </div>

      {asset && <div className="mt-6"><Workspace key={`${asset.id}-${asset.updatedAt}`} productId={productId} asset={asset} options={options} onData={setData} /></div>}

      <ConfirmDialog open={confirmRemove} title="Remove this 3D model?" confirmLabel="Remove"
        message="The model file and this product's style options will be deleted. Customers' saved designs are kept but can no longer be opened."
        loading={remove.isPending} onConfirm={() => remove.mutate()} onCancel={() => setConfirmRemove(false)} />
    </div>
  );
}
