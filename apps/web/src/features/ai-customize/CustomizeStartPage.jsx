import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Sparkles, Trash2, Upload } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import ProductImage from '../../components/ImagePlaceholder.jsx';
import { ErrorMessage, Notice, Spinner } from '../../components/ui/Feedback.jsx';
import { aiService } from '../../services/ai.service.js';
import { catalogService } from '../../services/store.service.js';
import { parseError } from '../../services/api.js';
import ConsentBox, { ViewSelect } from './ConsentBox.jsx';

const TYPE_LABELS = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' };

/**
 * /customize/product/:slug  -> start (or resume) a customization of a store product
 * /customize/upload         -> start a customization of the customer's own garment photo
 */
export default function CustomizeStartPage({ mode }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const inputRef = useRef(null);
  const [consent, setConsent] = useState(false);
  const [view, setView] = useState('front');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fileError, setFileError] = useState('');
  const [progress, setProgress] = useState(0);
  const isProduct = mode === 'product';

  const cfg = useQuery({ queryKey: ['ai-config'], queryFn: aiService.config });
  const product = useQuery({ queryKey: ['product', slug], queryFn: () => catalogService.product(slug), enabled: isProduct });
  const existing = useQuery({
    queryKey: ['ai-sessions', 'product', product.data?.id], queryFn: () => aiService.sessions({ productId: product.data.id }),
    enabled: isProduct && !!product.data?.id,
  });

  // "Create or resume": a customer who already customized this product goes straight back to that session.
  useEffect(() => {
    if (isProduct && existing.data?.[0]) navigate(`/customize/session/${existing.data[0].id}`, { replace: true });
  }, [isProduct, existing.data, navigate]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const start = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('type', mode);
      form.append('viewHint', view);
      form.append('consent', 'true');
      form.append('consentVersion', cfg.data.consent.version);
      if (isProduct) form.append('productId', String(product.data.id));
      else { form.append('title', title.trim()); form.append('image', file); }
      return aiService.createSession(form, setProgress);
    },
    onSuccess: ({ session }) => {
      qc.invalidateQueries({ queryKey: ['ai-sessions'] });
      navigate(`/customize/session/${session.id}`, { replace: true });
    },
    onSettled: () => setProgress(0),
  });

  const pick = (f) => {
    setFileError('');
    if (!f) return;
    const c = cfg.data;
    if (!c.uploads.acceptedTypes.includes(f.type)) { setFileError(`Use ${c.uploads.acceptedTypes.map((t) => TYPE_LABELS[t]).join(', ')}.`); return; }
    if (f.size > c.uploads.maxMb * 1024 * 1024) { setFileError(`The image is too large (maximum ${c.uploads.maxMb} MB).`); return; }
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    if (inputRef.current) inputRef.current.value = '';
  };

  if (cfg.isLoading || (isProduct && (product.isLoading || existing.isLoading))) return <Spinner />;
  if (cfg.isError || (isProduct && product.isError)) {
    return <div className="container-page py-12"><ErrorMessage message="We could not load AI customization." onRetry={() => { cfg.refetch(); product.refetch?.(); }} /></div>;
  }
  const c = cfg.data;
  const p = product.data;
  const back = isProduct ? `/shop/${slug}` : '/account/ai-designs';
  const blocked = isProduct && p && !p.aiCustomizeEligible;
  const err = start.isError ? parseError(start.error) : null;
  const ready = c.customizationAvailable && consent && !start.isPending && (isProduct ? !blocked : !!file && title.trim().length >= 3);

  return (
    <div className="container-page py-8 sm:py-12">
      <Link to={back} className="mb-6 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back</Link>
      <h1 className="h-section">{isProduct ? 'Customize with AI chat' : 'Customize your own garment photo'}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        {isProduct
          ? <>Describe the changes you want to <strong className="font-medium text-ink">{p?.name}</strong> in plain language. The result is a visual design concept, not an order.</>
          : 'Upload a photo of a garment, then describe the changes you want in plain language. The result is a visual design concept.'}
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
        <aside className="mx-auto w-full max-w-sm lg:max-w-none">
          {isProduct ? (
            <>
              <ProductImage src={p?.images?.[0]?.url} alt={p?.name} ratio="aspect-[4/5]" className="rounded-2xl" />
              <p className="mt-3 text-center text-sm font-medium">{p?.name}</p>
            </>
          ) : preview ? (
            <img src={preview} alt="Your garment photo" className="mx-auto max-h-[60vh] w-auto max-w-full rounded-2xl bg-sand object-contain" />
          ) : (
            <div className="flex aspect-[4/5] items-center justify-center rounded-2xl border-2 border-dashed border-line text-center text-sm text-muted"><p className="px-6">Your garment photo will appear here.</p></div>
          )}
        </aside>

        <div className="min-w-0 space-y-6">
          {!c.customizationAvailable && <Notice type="error">AI customization is temporarily unavailable. Please try again later.</Notice>}
          {blocked && <Notice type="error">This product cannot be customized because it has no image.</Notice>}

          {!isProduct && (
            <section className="card p-5 sm:p-6">
              <h2 className="font-sans text-base font-semibold">1. Your garment photo</h2>
              <p className="mt-1 text-sm text-muted">Use a clear photo of one garment on its own or worn, with the side you want to edit fully visible. {c.uploads.acceptedTypes.map((t) => TYPE_LABELS[t]).join(', ')} · up to {c.uploads.maxMb} MB · shorter side at least {c.uploads.minSide}px.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant={file ? 'outline' : 'primary'} disabled={start.isPending} onClick={() => inputRef.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />{file ? 'Replace image' : 'Choose image'}</Button>
                {file && <Button size="sm" variant="ghost" disabled={start.isPending} onClick={() => { setFile(null); setPreview(null); }}><Trash2 className="h-4 w-4" aria-hidden="true" />Remove</Button>}
              </div>
              <input ref={inputRef} type="file" accept={c.uploads.acceptedTypes.join(',')} className="sr-only" tabIndex={-1} aria-label="Choose a garment image" onChange={(e) => pick(e.target.files?.[0])} />
              {fileError && <div className="mt-3"><Notice type="error">{fileError}</Notice></div>}
              <div className="mt-4">
                <label htmlFor="ai-title" className="block text-sm font-medium">What garment is this?</label>
                <input id="ai-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. white cotton shirt" className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-sm" />
              </div>
            </section>
          )}

          <section className="card p-5 sm:p-6">
            <h2 className="font-sans text-base font-semibold">{isProduct ? '1. About the image' : '2. About the image'}</h2>
            <div className="mt-3"><ViewSelect value={view} onChange={setView} disabled={start.isPending} /></div>
          </section>

          {c.consent && <ConsentBox consent={c.consent} checked={consent} onChange={setConsent} disabled={start.isPending} />}

          {err && <Notice type="error">{err.message}{Object.values(err.fields).length ? `: ${Object.values(err.fields).join('; ')}` : ''}</Notice>}

          <div>
            <Button size="lg" className="w-full sm:w-auto" disabled={!ready} onClick={() => start.mutate()}>
              {start.isPending ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{progress > 0 && progress < 100 ? `Uploading… ${progress}%` : 'Starting…'}</> : <><Sparkles className="h-4 w-4" aria-hidden="true" />Start customizing</>}
            </Button>
            <p className="mt-2 text-xs text-muted">Nothing is sent to any AI service until you send your first chat message. AI results can contain mistakes and are not guaranteed to match your request.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
