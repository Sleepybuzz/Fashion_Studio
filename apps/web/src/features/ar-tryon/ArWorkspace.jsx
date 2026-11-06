import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useGLTF, useProgress } from '@react-three/drei';
import { AlertTriangle, Camera, Check, Circle, FlipHorizontal, Info, Loader2, Move, ScanLine, X } from 'lucide-react';
import { imageSrc } from '../../services/api.js';
import ArScene from './ArScene.jsx';
import ArCustomizePanel from './ArCustomizePanel.jsx';
import CapturePreview from './CapturePreview.jsx';
import { guidanceFor } from './arMath.js';
import { composeCapture } from './captureUtils.js';
import { useCamera } from './useCamera.js';
import { usePoseTracking } from './usePoseTracking.js';

const LANDSCAPE_SHORT = '[@media(orientation:landscape)_and_(max-height:520px)]';

function Problem({ title, message, steps, onRetry, onExit, retryLabel = 'Try again' }) {
  return (
    <div role="alert" className="absolute inset-0 z-20 flex items-center justify-center overflow-y-auto bg-neutral-950/95 p-5">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-300" aria-hidden="true" />
        <h2 className="mt-3 font-sans text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-white/75">{message}</p>
        {steps?.length > 0 && <ul className="mt-3 space-y-1.5 text-left text-sm text-white/75">{steps.map((s) => <li key={s} className="flex gap-2"><span aria-hidden="true">•</span><span>{s}</span></li>)}</ul>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {onRetry && <button type="button" onClick={onRetry} className="h-11 rounded-full bg-white px-6 text-sm font-medium text-neutral-900">{retryLabel}</button>}
          <button type="button" onClick={onExit} className="h-11 rounded-full border border-white/30 px-6 text-sm font-medium hover:bg-white/10">Leave AR try-on</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Live AR stage: camera <video> + transparent WebGL garment layer + controls. Mounted only after the customer pressed
 * "Start camera"; unmounting stops every camera track and disposes tracking and 3D resources.
 */
export default function ArWorkspace({ product, ar, studio, custom, look, rules, matInfo, onInfo, onColor, onMaterial, onOption, onReset, dirty, snapshot, capture, isCustomer, isGuest, onExit }) {
  const location = useLocation();
  const cam = useCamera();
  const stageRef = useRef(null);
  const boxRef = useRef({ w: 0, h: 0 });
  const poseRef = useRef(null);
  const apiRef = useRef(null);
  const debugRef = useRef(null);
  const showPointsRef = useRef(false);
  const mirroredRef = useRef(true);
  mirroredRef.current = cam.mirrored;

  const [assetState, setAssetState] = useState({ status: 'loading', message: '' });
  const [sceneKey, setSceneKey] = useState(0);
  const [showPoints, setShowPoints] = useState(false);
  const [showTips, setShowTips] = useState(true);
  const [shot, setShot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [capError, setCapError] = useState('');
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia?.('(min-width:1024px)').matches ?? false);
  showPointsRef.current = showPoints;

  const asset = useMemo(() => {
    const cfg = { garmentType: ar.garmentType, scaleAdjust: ar.scaleAdjust, offsetYAdjust: ar.offsetYAdjust };
    return ar.assetMode === 'model3d'
      ? { mode: 'model3d', url: imageSrc(studio.asset.fileUrl), cfg }
      : { mode: 'overlay2d', url: imageSrc(ar.overlay.url), overlay: ar.overlay, cfg };
  }, [ar, studio]);

  // ---- stage size (CSS pixels) for coordinate mapping; also resizes the debug canvas
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      boxRef.current = { w: r.width, h: r.height };
      const d = debugRef.current;
      if (d) { const dpr = window.devicePixelRatio || 1; d.width = Math.round(r.width * dpr); d.height = Math.round(r.height * dpr); }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- camera starts when the workspace mounts (the customer already pressed "Start camera")
  useEffect(() => { cam.start('user'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ---- lock page scroll behind the full-screen workspace
  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => { document.documentElement.style.overflow = prev; };
  }, []);

  const drawPoints = useCallback((out) => {
    const c = debugRef.current;
    const ctx = c?.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const p = out?.points || {};
    if (!p.lShoulder) return;
    ctx.strokeStyle = 'rgba(80,220,160,.9)'; ctx.fillStyle = 'rgba(80,220,160,.95)'; ctx.lineWidth = 2;
    const line = (a, b) => { if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } };
    line(p.lShoulder, p.rShoulder); line(p.shoulderMid, p.hipMid);
    for (const pt of Object.values(p)) { ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2); ctx.fill(); }
  }, []);

  const onUpdate = useCallback((out) => {
    poseRef.current = out;
    apiRef.current?.invalidate();
    if (showPointsRef.current) drawPoints(out);
  }, [drawPoints]);
  useEffect(() => { if (!showPoints) debugRef.current?.getContext('2d')?.clearRect(0, 0, 99999, 99999); }, [showPoints]);

  const getStage = useCallback(() => ({ boxW: boxRef.current.w, boxH: boxRef.current.h, mirrored: mirroredRef.current }), []);
  const track = usePoseTracking({ videoRef: cam.videoRef, enabled: cam.status !== 'error', active: cam.status === 'running', paused: !!shot, getStage, onUpdate });
  const { live } = track;

  useEffect(() => { if (live.state === 'tracking' && live.hints.length === 0) setShowTips(false); }, [live]);

  const exit = useCallback(() => { cam.stop(); onExit(); }, [cam, onExit]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !shot) exit(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [exit, shot]);

  const switchCamera = () => { poseRef.current = null; cam.switchCamera(); };

  const takeShot = async () => {
    setCapError('');
    if (live.state !== 'tracking' && live.state !== 'holding') { setCapError('Step into the picture so the garment appears, then capture.'); return; }
    setBusy(true);
    try {
      const garmentCanvas = apiRef.current?.grabCanvas();
      if (!garmentCanvas) throw new Error('The garment layer is not ready.');
      const { blob, width, height } = await composeCapture({ video: cam.videoRef.current, garmentCanvas, boxW: boxRef.current.w, boxH: boxRef.current.h, mirrored: cam.mirrored });
      setShot({ blob, width, height, url: URL.createObjectURL(blob) });
    } catch (err) {
      setCapError(err?.message || 'The screenshot could not be created. Please try again.');
    } finally { setBusy(false); }
  };
  const closeShot = useCallback(() => { setShot((s) => { if (s) URL.revokeObjectURL(s.url); return null; }); }, []);
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  const retryAsset = () => { if (asset.mode === 'model3d') useGLTF.clear(asset.url); setAssetState({ status: 'loading', message: '' }); setSceneKey((k) => k + 1); };
  const onAssetError = useCallback((err) => setAssetState({ status: 'error', message: err?.code === 'bad_asset' ? 'This garment model cannot be used for live AR.' : 'The garment could not be loaded.' }), []);
  const onAssetReady = useCallback(() => setAssetState({ status: 'ready', message: '' }), []);
  const onContextLost = useCallback(() => setAssetState({ status: 'error', message: 'The graphics context was lost (this can happen on low-memory devices).' }), []);

  const garmentLoad = useProgress();
  const camPct = cam.status === 'idle' || cam.status === 'starting' ? 0 : 100;
  const trackPct = track.status === 'running' ? 100 : track.loadProgress.pct;
  const garmentPct = assetState.status === 'ready' ? 100 : Math.min(99, Math.round(garmentLoad.progress || 0));
  const overallPct = Math.round(camPct * 0.1 + trackPct * 0.6 + garmentPct * 0.3);
  const loading = cam.status !== 'error' && overallPct < 100 && assetState.status !== 'error';
  const loadLabel = camPct < 100 ? 'Starting camera…' : trackPct < 100 ? track.loadProgress.label : 'Loading garment…';

  // ---- step checklist: which step is done, and after how many seconds (counted from opening the AR view)
  const t0 = useRef(performance.now());
  const [doneAt, setDoneAt] = useState({});
  const stepFlags = {
    camera: cam.status === 'running',
    files: track.loadProgress.pct >= 76 || track.status === 'running',
    engine: track.status === 'running',
    garment: assetState.status === 'ready',
    body: live.state === 'tracking' || live.state === 'holding',
  };
  useEffect(() => {
    setDoneAt((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(stepFlags)) if (v && next[k] == null) { next[k] = (performance.now() - t0.current) / 1000; changed = true; }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepFlags.camera, stepFlags.files, stepFlags.engine, stepFlags.garment, stepFlags.body]);
  const filesFrac = Math.max(0, Math.min(1, (track.loadProgress.pct - 12) / 63));
  const steps = [
    { key: 'camera', label: 'Camera started', note: null, ready: true },
    { key: 'files', label: 'Tracking files downloaded', note: track.loadProgress.pct >= 12 ? `${Math.round(filesFrac * 100)}%` : null, ready: true },
    { key: 'engine', label: 'Body-tracking engine started', note: null, ready: doneAt.files != null },
    { key: 'garment', label: 'Garment loaded', note: `${Math.min(99, Math.round(garmentLoad.progress || 0))}%`, ready: true },
    { key: 'body', label: 'Your body detected', note: null, ready: doneAt.camera != null && doneAt.engine != null },
  ];
  const showSteps = cam.status !== 'error' && assetState.status !== 'error' && !steps.every((st) => doneAt[st.key] != null);
  const cardPct = Math.round(overallPct * 0.85 + (doneAt.body != null ? 15 : 0));

  const guidance = guidanceFor(live);
  const pill = loading ? null
    : live.state === 'tracking' && !guidance ? { t: 'Tracking', c: 'bg-emerald-500/80' }
    : guidance ? { t: guidance, c: 'bg-amber-500/85 text-neutral-900' } : null;

  const captureDisabled = busy || cam.status !== 'running' || track.status !== 'running' || assetState.status !== 'ready';

  return (
    <div className={`fixed inset-0 z-[70] flex flex-col bg-neutral-950 text-white lg:flex-row ${LANDSCAPE_SHORT}:flex-row`}
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }} role="dialog" aria-modal="true" aria-label={`Real-time AR try-on: ${product.name}`}>
      <div ref={stageRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-black">
        <video ref={cam.videoRef} playsInline muted autoPlay aria-hidden="true" className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: cam.mirrored ? 'scaleX(-1)' : 'none' }} />
        {cam.status !== 'error' && (
          <>
            <ArScene key={sceneKey} poseRef={poseRef} apiRef={apiRef} asset={asset} look={look} rules={rules} lowQuality={live.slow}
              onInfo={onInfo} onReady={onAssetReady} onError={onAssetError} onContextLost={onContextLost} />
            <canvas ref={debugRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
          </>
        )}

        {/* top bar */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
          <button type="button" onClick={exit} aria-label="Exit AR try-on" className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/55 backdrop-blur hover:bg-black/75"><X className="h-5 w-5" aria-hidden="true" /></button>
          <div className="min-w-0 flex-1 text-center" aria-live="polite">
            {pill && <span className={`inline-flex max-w-full items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium backdrop-blur ${pill.c}`}>
              {false && <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}<span className="truncate sm:whitespace-normal">{pill.t}</span></span>}
          </div>
          <div className="pointer-events-auto flex gap-2">
            <button type="button" onClick={() => setShowPoints((v) => !v)} aria-pressed={showPoints} aria-label="Show tracking points" title="Show tracking points"
              className={`flex h-11 w-11 items-center justify-center rounded-full backdrop-blur ${showPoints ? 'bg-white text-neutral-900' : 'bg-black/55 hover:bg-black/75'}`}><ScanLine className="h-5 w-5" aria-hidden="true" /></button>
            {cam.hasMultiple && <button type="button" onClick={switchCamera} aria-label="Switch camera" title="Switch camera" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 backdrop-blur hover:bg-black/75"><FlipHorizontal className="h-5 w-5" aria-hidden="true" /></button>}
          </div>
        </div>

        {/* loading steps */}
        {showSteps && (
          <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center px-4" role="status" aria-live="polite">
            <div className="w-full max-w-xs rounded-2xl bg-black/65 p-3 backdrop-blur">
              <p className="text-center text-sm font-medium">Getting ready… {cardPct}%</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-emerald-400 transition-[width] duration-300" style={{ width: `${cardPct}%` }} /></div>
              <ul className="mt-3 space-y-1.5 text-xs">
                {steps.map((st) => {
                  const done = doneAt[st.key] != null;
                  return (
                    <li key={st.key} className={`flex items-center gap-2 ${done ? 'text-white' : st.ready ? 'text-white/80' : 'text-white/40'}`}>
                      {done ? <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" /> : st.ready ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <Circle className="h-4 w-4 shrink-0" aria-hidden="true" />}
                      <span className="flex-1">{st.label}</span>
                      <span className="tabular-nums text-white/60">{done ? `${doneAt[st.key].toFixed(1)}s` : st.ready ? st.note : null}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}

        {/* tips + notices */}
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 space-y-2">
          {showTips && cam.status === 'running' && (
            <div className="mx-auto max-w-md rounded-xl bg-black/60 p-3 text-sm backdrop-blur">
              <p className="flex items-center gap-2 font-medium"><Move className="h-4 w-4" aria-hidden="true" />For the best result</p>
              <p className="mt-1 text-white/80">Stand about 1–2 metres away, face the camera, keep your upper body in view and use good lighting.</p>
            </div>
          )}
          {live.slow && <p role="status" className="mx-auto max-w-md rounded-xl bg-amber-500/90 p-3 text-sm text-neutral-900">Your device is working hard, so tracking may lag. Close other apps or tabs for a smoother preview.</p>}
          {assetState.status === 'error' && (
            <div role="alert" className="pointer-events-auto mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-red-600/90 p-3 text-sm">
              <span>{assetState.message}</span><button type="button" onClick={retryAsset} className="shrink-0 rounded-full bg-white px-3 py-1.5 font-medium text-neutral-900">Retry</button>
            </div>
          )}
        </div>

        {cam.status === 'error' && <Problem {...cam.problem} onRetry={cam.problem?.retryable ? () => cam.start(cam.facing) : undefined} onExit={exit} />}
        {cam.status !== 'error' && track.status === 'error' && <Problem title="Body tracking could not start" message={track.error} steps={['Check your internet connection (the tracking files are downloaded once).', 'Try another browser such as the latest Chrome, Edge, Safari or Firefox.']} onRetry={track.retry} onExit={exit} />}
      </div>

      <aside className={`flex max-h-[46dvh] shrink-0 flex-col gap-3 overflow-y-auto border-t border-white/10 bg-neutral-900 p-3 lg:max-h-none lg:w-[360px] lg:border-l lg:border-t-0 lg:p-5 ${LANDSCAPE_SHORT}:max-h-none ${LANDSCAPE_SHORT}:w-[300px] ${LANDSCAPE_SHORT}:border-l ${LANDSCAPE_SHORT}:border-t-0`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0"><p className="truncate font-sans text-base font-semibold">{product.name}</p><p className="text-xs text-white/60">Real-time AR preview</p></div>
          <button type="button" onClick={takeShot} disabled={captureDisabled} aria-label="Capture screenshot"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-4 border-white/40 bg-white text-neutral-900 transition hover:scale-105 disabled:opacity-40 disabled:hover:scale-100">
            {busy ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /> : <Camera className="h-6 w-6" aria-hidden="true" />}
          </button>
        </div>
        {capError && <p role="alert" className="text-sm text-amber-300">{capError}</p>}

        {asset.mode === 'model3d' && studio ? (
          <div>
            <button type="button" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen} className="flex w-full items-center justify-between rounded-xl bg-white/5 px-3 py-2.5 text-sm font-medium hover:bg-white/10">
              Customize garment<span aria-hidden="true">{panelOpen ? '−' : '+'}</span>
            </button>
            {panelOpen && <div className="mt-3"><ArCustomizePanel studio={studio} state={custom} info={matInfo} onColor={onColor} onMaterial={onMaterial} onOption={onOption} onReset={onReset} dirty={dirty} /></div>}
          </div>
        ) : (
          <p className="rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white/70">This garment is shown as a fixed image, so colours and styles cannot be changed here.</p>
        )}

        <details className="rounded-xl bg-white/5 p-3 text-sm text-white/70">
          <summary className="flex cursor-pointer items-center gap-2 font-medium text-white"><Info className="h-4 w-4" aria-hidden="true" />About this preview</summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>Body tracking runs on your device. Camera pictures are not recorded or uploaded.</li>
            <li>The garment follows your shoulders and torso. It is an approximate overlay, not a fabric simulation or a size or fit measurement.</li>
            <li>The garment is drawn in front of you, so arms are not shown in front of it.</li>
            <li>For a realistic picture of the item on you, use AI Photo Try-On on the product page.</li>
          </ul>
        </details>
      </aside>

      {shot && (
        <CapturePreview shot={shot} product={product} capture={capture} isCustomer={isCustomer} isGuest={isGuest}
          loginState={{ from: `${location.pathname}${location.search}` }} config={asset.mode === 'model3d' ? snapshot : null}
          onDiscard={closeShot} onRetake={closeShot} />
      )}
    </div>
  );
}