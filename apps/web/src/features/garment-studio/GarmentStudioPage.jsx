import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Box } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import { ErrorMessage, Spinner } from '../../components/ui/Feedback.jsx';
import { garmentService } from '../../services/garment.service.js';
import { parseError, imageSrc } from '../../services/api.js';
import { useStoreInfo } from '../../hooks/useStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { formatPrice } from '../../utils/format.js';
import GarmentViewer from './GarmentViewer.jsx';
import CustomizationPanel from './CustomizationPanel.jsx';
import { buildVisibilityRules, defaultSelections, resolveConfig, stateSignature } from './studioUtils.js';

const draftKey = (slug) => `afs-studio-draft:${slug}`;
const readDraft = (slug) => { try { return JSON.parse(sessionStorage.getItem(draftKey(slug)) || 'null'); } catch { return null; } };
const writeDraft = (slug, v) => { try { sessionStorage.setItem(draftKey(slug), JSON.stringify(v)); } catch { /* storage unavailable */ } };
const clearDraft = (slug) => { try { sessionStorage.removeItem(draftKey(slug)); } catch { /* ignore */ } };

/** Public 3D studio: /studio/:slug  (optionally ?design=<savedDesignId>). */
export default function GarmentStudioPage() {
  const { slug } = useParams();
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const designParam = search.get('design');
  const qc = useQueryClient();
  const { data: info } = useStoreInfo();
  const { token, user } = useAuthStore();
  const isCustomer = !!token && user?.role === 'customer';

  const studioQ = useQuery({ queryKey: ['studio', slug], queryFn: () => garmentService.studio(slug), retry: (n, e) => e?.response?.status >= 500 && n < 2 });
  const studio = studioQ.data;
  const designQ = useQuery({
    queryKey: ['design', designParam], queryFn: () => garmentService.design(designParam),
    enabled: !!designParam && isCustomer, retry: false,
  });

  const [state, setState] = useState({ colorKey: null, materialKey: null, selections: {} });
  const [name, setName] = useState('');
  const [designId, setDesignId] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [dropped, setDropped] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [matInfo, setMatInfo] = useState(null);
  const initKey = useRef('');

  // Initialise state once per product / saved design: saved config > guest draft > defaults.
  useEffect(() => {
    if (!studio) return;
    const key = `${studio.product.id}:${designParam || ''}`;
    const wantsDesign = !!designParam && isCustomer;
    if (wantsDesign && designQ.isLoading) return;
    if (initKey.current === key) return;
    if (wantsDesign && designQ.data && designQ.data.productId === studio.product.id) {
      initKey.current = key;
      const r = resolveConfig(designQ.data.config, studio);
      const s = { colorKey: r.colorKey, materialKey: r.materialKey, selections: r.selections };
      setState(s); setSnapshot(stateSignature(s)); setName(designQ.data.name); setDesignId(designQ.data.id); setDropped(r.dropped);
      return;
    }
    initKey.current = key;
    const draft = readDraft(slug);
    const r = resolveConfig(draft ? { colorKey: draft.colorKey, materialKey: draft.materialKey, options: draft.selections } : null, studio);
    const s = { colorKey: r.colorKey, materialKey: r.materialKey, selections: r.selections };
    setState(s); setSnapshot(draft ? null : stateSignature(s)); setName(''); setDesignId(null); setDropped(false);
    if (draft) clearDraft(slug);
  }, [studio, designQ.data, designQ.isLoading, designParam, isCustomer, slug]);

  const rules = useMemo(() => (studio ? buildVisibilityRules(studio.options, state.selections) : []), [studio, state.selections]);
  const look = useMemo(() => ({
    colorHex: studio?.colors.find((c) => c.key === state.colorKey)?.hex ?? null,
    preset: studio?.materials.find((m) => m.key === state.materialKey) ?? null,
    materialNames: studio?.asset.customizableMaterials ?? [],
  }), [studio, state.colorKey, state.materialKey]);

  const dirty = snapshot !== null && stateSignature(state) !== snapshot;
  const onInfo = useCallback((i) => setMatInfo(i), []);

  const payload = () => ({ colorKey: state.colorKey, materialKey: state.materialKey, options: state.selections });
  const afterSave = (d, text) => {
    setDesignId(d.id); setName(d.name); setSnapshot(stateSignature(state)); setSaveError(''); setMessage(text);
    setSearch({ design: String(d.id) }, { replace: true });
    initKey.current = `${studio.product.id}:${d.id}`;
    qc.invalidateQueries({ queryKey: ['designs'] });
    qc.setQueryData(['design', String(d.id)], d);
  };
  const onFail = (e) => { setMessage(''); setSaveError(parseError(e).message); };
  const create = useMutation({
    mutationFn: () => garmentService.createDesign({ productId: studio.product.id, name: name.trim() || undefined, config: payload() }),
    onSuccess: (d) => afterSave(d, 'Design saved. Find it under My account → 3D designs.'), onError: onFail,
  });
  const update = useMutation({
    mutationFn: () => garmentService.updateDesign(designId, { name: name.trim() || undefined, config: payload() }),
    onSuccess: (d) => afterSave(d, 'Design updated.'), onError: onFail,
  });
  const saving = create.isPending || update.isPending;

  const reset = () => { setState({ colorKey: null, materialKey: null, selections: defaultSelections(studio.options) }); setMessage(''); };
  const stashDraft = () => writeDraft(slug, { colorKey: state.colorKey, materialKey: state.materialKey, selections: state.selections });

  if (studioQ.isLoading) return <Spinner label="Opening the studio…" className="py-32" />;
  if (studioQ.error?.response?.status === 404) {
    const noModel = /3D model/i.test(studioQ.error.response.data?.error?.message || '');
    return (
      <div className="container-page py-20 text-center">
        <Box className="mx-auto h-10 w-10 text-muted" aria-hidden="true" />
        <h1 className="h-section mt-4">{noModel ? 'No 3D model for this product yet' : 'Product not found'}</h1>
        <p className="mt-2 text-muted">{noModel ? 'The store has not added a 3D model for this product, so it cannot be customized in 3D.' : 'It may have been removed or is no longer available.'}</p>
        <Link to={noModel ? `/shop/${slug}` : '/shop'} className="mt-6 inline-block font-medium text-brand hover:underline">{noModel ? 'Back to product' : 'Back to shop'}</Link>
      </div>
    );
  }
  if (studioQ.error) return <div className="container-page py-12"><ErrorMessage message="We could not load the 3D studio." onRetry={studioQ.refetch} /></div>;

  const designMissing = !!designParam && isCustomer && (designQ.isError || (designQ.data && designQ.data.productId !== studio.product.id));
  const p = studio.product;

  return (
    <div className="container-page py-4 sm:py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link to={`/shop/${p.slug}`} className="inline-flex min-h-[44px] items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to product</Link>
        <p className="text-xs uppercase tracking-wide text-muted">3D Garment Studio</p>
      </div>
      {designMissing && <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">That saved design could not be found, so the default look is shown.</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8">
        <div className="h-[52vh] min-h-[300px] max-h-[620px] lg:sticky lg:top-24 lg:h-[calc(100vh-9rem)] lg:max-h-none lg:min-h-[480px]">
          <GarmentViewer url={imageSrc(studio.asset.fileUrl)} name={p.name} look={look} rules={rules} onInfo={onInfo} />
        </div>

        <aside className="min-w-0">
          <div className="mb-6 flex items-start gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-2xl leading-tight sm:text-3xl">{p.name}</h1>
              <p className="mt-1 text-lg">{formatPrice(p.price, info?.currency || 'INR')}</p>
              {p.categoryName && <p className="text-sm text-muted">{p.categoryName}</p>}
            </div>
          </div>
          <CustomizationPanel
            studio={studio} state={state} info={matInfo}
            onColor={(k) => { setState((s) => ({ ...s, colorKey: k })); setMessage(''); }}
            onMaterial={(k) => { setState((s) => ({ ...s, materialKey: k })); setMessage(''); }}
            onOption={(ok, vk) => { setState((s) => ({ ...s, selections: { ...s.selections, [ok]: vk } })); setMessage(''); }}
            onReset={reset}
            isGuest={!token} isCustomer={isCustomer} canSave={isCustomer}
            loginState={{ from: `${location.pathname}${location.search}` }} onLogin={stashDraft}
            name={name} onName={setName} editing={!!designId} dirty={dirty} saving={saving}
            onSave={() => (designId ? update.mutate() : create.mutate())}
            onSaveAsNew={() => create.mutate()}
            message={message} error={saveError} droppedNotice={dropped}
          />
          <div className="mt-6"><Button to={`/shop/${p.slug}`} variant="outline" size="sm">View product details</Button></div>
        </aside>
      </div>
    </div>
  );
}
