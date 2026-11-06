import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Camera, Info, Loader2, ShieldCheck, Trash2, Upload } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import PrivateImage from './PrivateImage.jsx';
import ProductImage from '../../components/ImagePlaceholder.jsx';
import { ErrorMessage, Notice, Spinner } from '../../components/ui/Feedback.jsx';
import { tryOnService } from '../../services/tryon.service.js';
import { parseError } from '../../services/api.js';
import { ACCEPTED_TYPES, checkPickedFile, preparePhoto } from './photoUtils.js';

const GUIDE = [
  'Stand facing the camera in good, even light.',
  'Show your head to at least your knees; fully visible shoulders and torso matter most.',
  'Wear fitted or simple clothes; avoid bulky coats and very loose layers.',
  'One person only, no heavy filters, no group photos.',
];

/** /try-on/:slug — consent, photo, submit. Processing and the result live on the session page. */
export default function VirtualTryOnPage({ custom = false }) {
  const { slug, versionId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const inputRef = useRef(null);
  const [consent, setConsent] = useState(false);
  const [photo, setPhoto] = useState(null); // { file, width, height, previewUrl }
  const [preparing, setPreparing] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const canCapture = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

  const cfg = useQuery({ queryKey: ['tryon-config'], queryFn: tryOnService.config });
  const elig = useQuery({ queryKey: ['tryon-eligibility', custom ? `custom:${versionId}` : slug], queryFn: () => (custom ? tryOnService.customEligibility(versionId) : tryOnService.eligibility(slug)) });

  // Free the preview object URL when it is replaced or the page closes.
  useEffect(() => () => { if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl); }, [photo]);

  const submit = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('photo', photo.file);
      if (custom) form.append('customizationVersionId', versionId);
      else form.append('productId', String(elig.data.product.id));
      form.append('consent', 'true');
      form.append('consentVersion', cfg.data.consent.version);
      return tryOnService.create(form, setProgress);
    },
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ['tryon-sessions'] });
      qc.invalidateQueries({ queryKey: ['tryon-config'] });
      navigate(`/account/try-ons/${session.id}`, { replace: true });
    },
    onSettled: () => setProgress(0),
  });

  const pick = async (file) => {
    setPhotoError('');
    const problem = checkPickedFile(file);
    if (problem) { setPhotoError(problem); return; }
    setPreparing(true);
    try {
      const prepared = await preparePhoto(file, { minSide: cfg.data.limits.minPhotoSide, maxBytes: cfg.data.limits.maxPhotoMb * 1024 * 1024 });
      setPhoto(prepared);
    } catch (e) {
      setPhotoError(e.message);
    } finally {
      setPreparing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  if (cfg.isLoading || elig.isLoading) return <Spinner />;
  if (cfg.isError || elig.isError) {
    return <div className="container-page py-12"><ErrorMessage message="We could not load virtual try-on." onRetry={() => { cfg.refetch(); elig.refetch(); }} /></div>;
  }

  const c = cfg.data;
  const e = elig.data;
  const back = (
    <Link to={custom ? '/account/ai-designs' : e.product ? `/shop/${e.product.slug}` : '/shop'} className="mb-6 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />{custom ? 'Back to my AI designs' : 'Back to product'}
    </Link>
  );

  if (!e.eligible) {
    return (
      <div className="container-page max-w-2xl py-12">
        {back}
        <Notice type="error">{e.message || 'Virtual try-on is not available for this product.'}</Notice>
      </div>
    );
  }

  const busy = submit.isPending;
  const submitError = submit.isError ? parseError(submit.error) : null;
  const ready = c.available && consent && !!photo && !preparing && !busy && !c.activeSessionId;

  return (
    <div className="container-page py-8 sm:py-12">
      {back}
      <h1 className="h-section">Virtual try-on</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">See how {custom ? 'your customized design' : null}{custom ? null : <strong className="font-medium text-ink">{e.product.name}</strong>} could look on you. An AI model creates an image from your photo and the garment photos.</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
        <aside className="mx-auto w-full max-w-sm lg:max-w-none">
          {custom
            ? <PrivateImage src={e.product.primaryImage} alt={e.product.name} className="mx-auto max-h-[60vh] w-auto max-w-full rounded-2xl bg-sand object-contain" />
            : <ProductImage src={e.product.primaryImage} alt={e.product.name} ratio="aspect-[4/5]" className="rounded-2xl" />}
          <p className="mt-3 text-center text-sm font-medium">{e.product.name}</p>
        </aside>

        <div className="min-w-0 space-y-6">
          {!c.available && <Notice type="error">Virtual try-on is temporarily unavailable. Please try again later.</Notice>}
          {c.provider.testMode && <Notice type="error"><strong>Test mode.</strong> The store is testing this feature. The result will not be a real AI try-on.</Notice>}
          {c.activeSessionId && (
            <Notice type="success">You already have a try-on in progress. <Link className="font-medium underline" to={`/account/try-ons/${c.activeSessionId}`}>View it</Link>.</Notice>
          )}

          <section className="card p-5 sm:p-6" aria-labelledby="step-consent">
            <h2 id="step-consent" className="flex items-center gap-2 font-sans text-base font-semibold"><ShieldCheck className="h-5 w-5 text-brand" aria-hidden="true" />1. Privacy and consent</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted">
              {c.consent.points.map((p) => <li key={p}>{p}</li>)}
            </ul>
            {c.provider.privacyUrl && <p className="mt-3 text-xs text-muted">Read the provider's <a className="underline" href={c.provider.privacyUrl} target="_blank" rel="noreferrer noopener">privacy policy</a>.</p>}
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-sand p-3 text-sm">
              <input type="checkbox" checked={consent} onChange={(ev) => setConsent(ev.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#7952A3]" />
              <span>{c.consent.checkboxLabel}</span>
            </label>
          </section>

          <section className={`card p-5 sm:p-6 ${consent ? '' : 'opacity-60'}`} aria-labelledby="step-photo">
            <h2 id="step-photo" className="flex items-center gap-2 font-sans text-base font-semibold"><Camera className="h-5 w-5 text-brand" aria-hidden="true" />2. Your photo</h2>
            {!consent && <p className="mt-2 text-sm text-muted">Please accept the consent above to choose a photo.</p>}
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">{GUIDE.map((g) => <li key={g}>{g}</li>)}</ul>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />Your photo is resized in your browser and location/camera data is removed before upload. Nothing is sent until you press “Create my try-on”.</p>

            {photo ? (
              <div className="mt-4">
                <img src={photo.previewUrl} alt="Your selected photo" className="mx-auto max-h-[60vh] w-auto max-w-full rounded-2xl bg-sand object-contain" />
                <p className="mt-2 text-center text-xs text-muted">{photo.width} × {photo.height}px</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button variant="outline" size="sm" disabled={!consent || busy} onClick={() => inputRef.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />Replace photo</Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPhoto(null)}><Trash2 className="h-4 w-4" aria-hidden="true" />Remove</Button>
                </div>
              </div>
            ) : (
              <div
                onDragOver={(ev) => { if (consent) { ev.preventDefault(); setDragOver(true); } }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(ev) => { ev.preventDefault(); setDragOver(false); if (consent && ev.dataTransfer.files[0]) pick(ev.dataTransfer.files[0]); }}
                className={`mt-4 flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-10 text-center ${dragOver ? 'border-brand bg-brand/5' : 'border-line'}`}>
                {preparing ? <Spinner label="Preparing your photo…" className="py-0" /> : (
                  <>
                    <Upload className="h-8 w-8 text-muted" aria-hidden="true" />
                    <p className="text-sm text-muted">Drag a photo here, or choose one</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button size="sm" disabled={!consent} onClick={() => inputRef.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />Choose photo</Button>
                      {canCapture && <Button size="sm" variant="outline" disabled={!consent} onClick={() => { inputRef.current.setAttribute('capture', 'user'); inputRef.current.click(); inputRef.current.removeAttribute('capture'); }}><Camera className="h-4 w-4" aria-hidden="true" />Take a photo</Button>}
                    </div>
                    <p className="text-xs text-muted">JPEG, PNG or WebP · shorter side at least {c.limits.minPhotoSide}px</p>
                  </>
                )}
              </div>
            )}
            <input ref={inputRef} type="file" accept={ACCEPTED_TYPES.join(',')} className="sr-only" tabIndex={-1} aria-label="Choose a photo" disabled={!consent}
              onChange={(ev) => ev.target.files?.[0] && pick(ev.target.files[0])} />
            {photoError && <div className="mt-3"><Notice type="error">{photoError}</Notice></div>}
          </section>

          {submitError && <Notice type="error">{submitError.message}{Object.values(submitError.fields).length ? `: ${Object.values(submitError.fields).join('; ')}` : ''}</Notice>}

          <div>
            <Button size="lg" className="w-full sm:w-auto" disabled={!ready} onClick={() => submit.mutate()}>
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{progress < 100 ? `Uploading… ${progress}%` : 'Validating and sending…'}</> : 'Create my try-on'}
            </Button>
            <p className="mt-2 text-xs text-muted">Limit: {c.limits.dailyLimit || 'no'} try-ons per day. Results take about 10–60 seconds.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
