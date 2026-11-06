import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Camera, Lock, ScanFace, Sparkles } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import ProductImage from '../../components/ImagePlaceholder.jsx';
import { ErrorMessage, Notice, Spinner } from '../../components/ui/Feedback.jsx';
import { arService } from '../../services/ar.service.js';
import { garmentService } from '../../services/garment.service.js';
import { catalogService } from '../../services/store.service.js';
import { useAuthStore } from '../../stores/authStore.js';
import { buildVisibilityRules, defaultSelections, stateSignature } from '../garment-studio/studioUtils.js';
import ArWorkspace from './ArWorkspace.jsx';
import { prefetchTrackingAssets } from './poseTracker.js';
import { detectCapabilities, evaluateSupport } from './cameraUtils.js';

/** /ar-try-on/:slug — intro + consent-to-use-camera screen, then the live workspace. The camera is never started before the button press. */
export default function ArTryOnPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { token, user } = useAuthStore();
  const isCustomer = !!token && user?.role === 'customer';
  const isGuest = !token;
  const [started, setStarted] = useState(false);

  const arQ = useQuery({ queryKey: ['ar-product', slug], queryFn: () => arService.product(slug), retry: (n, e) => e?.response?.status >= 500 && n < 2 });
  const data = arQ.data;
  const studioQ = useQuery({ queryKey: ['studio', slug], queryFn: () => garmentService.studio(slug), enabled: data?.ar.assetMode === 'model3d', retry: false });
  const productQ = useQuery({ queryKey: ['product', slug], queryFn: () => catalogService.product(slug), retry: false });
  const studio = studioQ.data;

  const [custom, setCustom] = useState({ colorKey: null, materialKey: null, selections: {} });
  const [initialSig, setInitialSig] = useState('');
  const [matInfo, setMatInfo] = useState(null);
  useEffect(() => {
    if (!studio) return;
    const s = { colorKey: null, materialKey: null, selections: defaultSelections(studio.options) };
    setCustom(s); setInitialSig(stateSignature(s));
  }, [studio]);

  const rules = useMemo(() => (studio ? buildVisibilityRules(studio.options, custom.selections) : []), [studio, custom.selections]);
  const look = useMemo(() => ({
    colorHex: studio?.colors.find((c) => c.key === custom.colorKey)?.hex ?? null,
    preset: studio?.materials.find((m) => m.key === custom.materialKey) ?? null,
    materialNames: studio?.asset.customizableMaterials ?? [],
  }), [studio, custom.colorKey, custom.materialKey]);
  const reset = useCallback(() => studio && setCustom({ colorKey: null, materialKey: null, selections: defaultSelections(studio.options) }), [studio]);
  const onInfo = useCallback((i) => setMatInfo(i), []);

  const support = useMemo(() => evaluateSupport(detectCapabilities()), []);
  // Download the tracking library + model while the customer reads the intro, so "Start camera" does not wait for them.
  useEffect(() => { if (support.ok) prefetchTrackingAssets(); }, [support.ok]);
  const back = `/shop/${slug}`;

  if (arQ.isLoading || (data?.ar.assetMode === 'model3d' && studioQ.isLoading)) return <Spinner />;
  if (arQ.error?.response?.status === 404 || studioQ.error?.response?.status === 404) {
    return (
      <div className="container-page py-20 text-center">
        <h1 className="h-section">Real-time AR try-on isn’t available for this product</h1>
        <p className="mt-2 text-muted">It may not be set up yet, or the product is no longer available.</p>
        <Link to={back} className="mt-6 inline-block font-medium text-brand hover:underline">Back to the product</Link>
      </div>
    );
  }
  if (arQ.error || studioQ.error) return <div className="container-page py-12"><ErrorMessage message="We could not load the AR try-on." onRetry={() => { arQ.refetch(); studioQ.refetch(); }} /></div>;

  const { product, ar, capture } = data;

  if (started) {
    return (
      <ArWorkspace product={product} ar={ar} studio={studio} custom={custom} look={look} rules={rules} matInfo={matInfo} onInfo={onInfo}
        onColor={(k) => setCustom((s) => ({ ...s, colorKey: k }))} onMaterial={(k) => setCustom((s) => ({ ...s, materialKey: k }))}
        onOption={(o, v) => setCustom((s) => ({ ...s, selections: { ...s.selections, [o]: v } }))} onReset={reset}
        dirty={!!studio && stateSignature(custom) !== initialSig}
        snapshot={{ colorKey: custom.colorKey, materialKey: custom.materialKey, options: custom.selections }}
        capture={capture} isCustomer={isCustomer} isGuest={isGuest} onExit={() => { setStarted(false); navigate(back); }} />
    );
  }

  return (
    <div className="container-page py-8 sm:py-12">
      <Link to={back} className="mb-6 inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to {product.name}</Link>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr] lg:gap-14">
        <ProductImage src={product.primaryImage} alt={product.name} ratio="aspect-[4/5]" className="rounded-2xl" />
        <div>
          <h1 className="h-section">Real-time AR try-on</h1>
          <p className="mt-1 text-lg">{product.name}</p>
          <p className="mt-4 text-sm leading-relaxed text-muted">See {ar.assetMode === 'model3d' ? 'this garment as a 3D model' : 'this garment'} follow you on your live camera. Move around and it follows your shoulders. This is a quick visual preview, not a realistic fitting.</p>

          <ul className="mt-6 space-y-3 text-sm">
            <li className="flex gap-3"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" /><span><strong>Private by design.</strong> Body tracking runs on your device. Your camera picture is not recorded or uploaded.</span></li>
            <li className="flex gap-3"><Camera className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" /><span><strong>You choose what to keep.</strong> You can take a screenshot, preview it, and only save it to your account if you agree. Saved screenshots are private and deleted after {capture.retentionDays} days or when you delete them.</span></li>
            <li className="flex gap-3"><ScanFace className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" /><span><strong>For best results,</strong> stand 1–2 metres from the camera, face it, show your upper body and use good lighting.</span></li>
          </ul>

          {!support.ok && (
            <div className="mt-6 space-y-2">
              <Notice type="error">
                <p className="font-medium">This device or browser can’t run AR try-on.</p>
                <ul className="mt-1 list-disc pl-5">{support.problems.map((p) => <li key={p.code}>{p.message}</li>)}</ul>
              </Notice>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Button size="lg" variant="brand" disabled={!support.ok} onClick={() => setStarted(true)}><Camera className="h-4 w-4" aria-hidden="true" />Start camera</Button>
            <Button size="lg" variant="outline" to={back}>Not now</Button>
          </div>
          <p className="mt-3 text-xs text-muted">Your browser will ask for camera permission after you press “Start camera”.</p>

          <div className="mt-8 rounded-2xl border border-line bg-white p-4 text-sm">
            <p className="flex items-center gap-2 font-medium"><Sparkles className="h-4 w-4 text-brand" aria-hidden="true" />Real-time AR vs AI Photo Try-On</p>
            <p className="mt-2 text-muted"><strong className="text-ink">Real-time AR</strong> is a live, approximate overlay on your camera. It is instant and stays on your device.</p>
            <p className="mt-1 text-muted"><strong className="text-ink">AI Photo Try-On</strong> uploads a photo to an AI service and creates a realistic picture of the item on you. It takes longer and needs your consent to share the photo.</p>
            {productQ.data?.tryOnEligible && <Link to={`/try-on/${slug}`} className="mt-2 inline-block font-medium text-brand hover:underline">Try AI Photo Try-On instead</Link>}
          </div>
        </div>
      </div>
    </div>
  );
}
