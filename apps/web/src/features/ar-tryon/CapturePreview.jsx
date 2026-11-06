import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Check, Download, Loader2, LogIn, Trash2 } from 'lucide-react';
import { arService } from '../../services/ar.service.js';
import { parseError } from '../../services/api.js';

/**
 * Shows the captured image BEFORE anything is stored. Nothing is uploaded unless the customer ticks the consent box and
 * presses "Save to my account"; "Discard" simply drops the in-memory image.
 */
export default function CapturePreview({ shot, product, capture, isCustomer, isGuest, loginState, config, onDiscard, onRetake }) {
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState({ phase: 'idle', progress: 0, error: '' }); // idle | saving | saved
  const closeRef = useRef(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && state.phase !== 'saving') onDiscard(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDiscard, state.phase]);

  const save = async () => {
    setState({ phase: 'saving', progress: 0, error: '' });
    try {
      const form = new FormData();
      form.append('image', new File([shot.blob], 'ar-capture.jpg', { type: 'image/jpeg' }));
      form.append('productId', String(product.id));
      form.append('consent', 'true');
      form.append('consentVersion', capture.consentVersion);
      if (config) form.append('config', JSON.stringify(config));
      await arService.save(form, (p) => setState((s) => ({ ...s, progress: p })));
      setState({ phase: 'saved', progress: 100, error: '' });
    } catch (err) {
      setState({ phase: 'idle', progress: 0, error: parseError(err).message });
    }
  };

  const btn = 'inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium disabled:opacity-50';
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/80 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="ar-preview-title">
      <div className="my-auto grid w-full max-w-4xl gap-4 rounded-2xl bg-neutral-900 p-3 text-white sm:p-5 md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-xl bg-black">
          <img src={shot.url} alt={`Your AR preview of ${product.name}`} className="max-h-[60dvh] w-auto max-w-full object-contain md:max-h-[80dvh]" />
        </div>
        <div className="flex flex-col gap-3">
          <h2 id="ar-preview-title" className="font-sans text-lg font-semibold">Your AR preview</h2>
          <p className="text-sm text-white/70">An approximate live overlay of {product.name}, not a photograph of the real garment on you. Nothing has been saved yet.</p>

          {state.phase === 'saved' ? (
            <div role="status" className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium"><Check className="h-4 w-4" aria-hidden="true" />Saved privately to your account</p>
              <p className="mt-1 text-white/70">Only you can see it. Find it under My account → AR captures, where you can delete it any time.</p>
              <Link to="/account/ar-captures" className="mt-2 inline-block font-medium underline">Open my AR captures</Link>
            </div>
          ) : isCustomer ? (
            <div className="space-y-3 rounded-xl border border-white/15 p-3">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-white" />
                <span>I agree that this image, which shows me, is stored privately on this store’s servers so I can view it later. It is kept for {capture.retentionDays} days or until I delete it. It is not shared with anyone else, including AI services.</span>
              </label>
              <button type="button" onClick={save} disabled={!consent || state.phase === 'saving'} className={`${btn} w-full bg-white text-neutral-900 hover:bg-white/90`}>
                {state.phase === 'saving' ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Saving {state.progress}%</> : 'Save to my account'}
              </button>
              {state.error && <p role="alert" className="text-sm text-red-300">{state.error}</p>}
            </div>
          ) : isGuest ? (
            <div className="rounded-xl border border-white/15 p-3 text-sm">
              <p className="text-white/80">Log in to save this to your account. You can still download it to your device.</p>
              <Link to="/login" state={loginState} className={`${btn} mt-3 w-full border border-white/30 hover:bg-white/10`}><LogIn className="h-4 w-4" aria-hidden="true" />Log in to save</Link>
            </div>
          ) : (
            <p className="rounded-xl border border-white/15 p-3 text-sm text-white/80">Saved screenshots belong to customer accounts. You can download it instead.</p>
          )}

          <div className="mt-auto flex flex-wrap gap-2">
            <a href={shot.url} download="ai-fashion-studio-ar.jpg" className={`${btn} border border-white/30 hover:bg-white/10`}><Download className="h-4 w-4" aria-hidden="true" />Download</a>
            <button ref={closeRef} type="button" onClick={onRetake} disabled={state.phase === 'saving'} className={`${btn} border border-white/30 hover:bg-white/10`}><Camera className="h-4 w-4" aria-hidden="true" />Back to camera</button>
            {state.phase !== 'saved' && <button type="button" onClick={onDiscard} disabled={state.phase === 'saving'} className={`${btn} text-red-300 hover:bg-red-500/10`}><Trash2 className="h-4 w-4" aria-hidden="true" />Discard</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
