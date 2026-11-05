import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneScene } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AlertTriangle, Box, Loader2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';

/** Target height of the model inside the scene, in world units (camera is framed for this). */
const FIT_SIZE = 2.4;

const hasWebGL = () => {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
};

/** Release GPU resources of a loaded glTF and drop it from the loader cache. */
function disposeGltf(gltf, url) {
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      Object.values(m).forEach((v) => v?.isTexture && v.dispose());
      m.dispose();
    }
  });
  useGLTF.clear(url);
}
const pendingDispose = new WeakMap();

const readableProp = (m, key) => (m[key] && m[key].isColor ? m[key].clone() : m[key]);

/**
 * Clone the cached glTF scene (so edits never leak into the cache), give every mesh its own
 * material clone, remember each material's original look, and compute a framing transform.
 */
function prepareModel(gltf) {
  const scene = cloneScene(gltf.scene); // SkeletonUtils.clone also handles skinned (rigged) garments
  const map = new Map();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const cloneOf = (m) => {
      if (!map.has(m)) {
        const c = m.clone();
        c.userData.afsBase = {
          color: readableProp(c, 'color'), roughness: c.roughness, metalness: c.metalness,
          sheen: c.sheen, sheenRoughness: c.sheenRoughness, sheenColor: readableProp(c, 'sheenColor'),
        };
        map.set(m, c);
      }
      return map.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(cloneOf) : cloneOf(o.material);
  });
  scene.traverse((o) => { o.userData.afsBaseVisible = o.visible; });

  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const max = Math.max(size.x, size.y, size.z) || 1;
  const valid = !box.isEmpty() && Number.isFinite(max);
  return {
    scene,
    materials: [...map.values()],
    fit: { scale: valid ? FIT_SIZE / max : 1, offset: valid ? [-center.x, -center.y, -center.z] : [0, 0, 0] },
  };
}

/** Show/hide named nodes. Resets to the file's own visibility first so switching values is deterministic. */
function applyVisibility(scene, rules) {
  scene.traverse((o) => { o.visible = o.userData.afsBaseVisible; });
  const byName = new Map();
  scene.traverse((o) => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });
  for (const r of rules) {
    r.show.forEach((n) => { const o = byName.get(n); if (o) o.visible = true; });
    r.hide.forEach((n) => { const o = byName.get(n); if (o) o.visible = false; });
  }
}

/**
 * Apply colour + material preset to the customizable materials only.
 * Returns how many materials were editable so the UI can explain when nothing is.
 */
function applyLook(materials, { colorHex, preset, materialNames }) {
  let editable = 0;
  let sheenCapable = 0;
  for (const m of materials) {
    if (!m.isMeshStandardMaterial) continue; // e.g. unlit materials have no PBR parameters
    if (materialNames.length && !materialNames.includes(m.name)) continue;
    editable += 1;
    const b = m.userData.afsBase;
    m.color.copy(b.color);
    m.roughness = b.roughness;
    m.metalness = b.metalness;
    if (m.isMeshPhysicalMaterial) {
      sheenCapable += 1;
      const before = m.sheen > 0;
      m.sheen = b.sheen;
      m.sheenRoughness = b.sheenRoughness;
      m.sheenColor.copy(b.sheenColor);
      if (before !== m.sheen > 0) m.needsUpdate = true;
    }
    if (colorHex) m.color.set(colorHex);
    if (preset) {
      m.roughness = preset.roughness;
      m.metalness = preset.metalness;
      if (m.isMeshPhysicalMaterial) {
        const before = m.sheen > 0;
        m.sheen = preset.sheen;
        m.sheenRoughness = preset.sheenRoughness;
        m.sheenColor.copy(m.color).lerp(new THREE.Color('#ffffff'), 0.5);
        if (before !== m.sheen > 0) m.needsUpdate = true;
      }
    }
  }
  return { editable, sheenCapable, total: materials.length };
}

function GarmentModel({ url, look, rules, onInfo, onReady }) {
  const gltf = useGLTF(url, false); // false = no Draco (its decoder would be fetched from a CDN)
  const invalidate = useThree((s) => s.invalidate);
  const model = useMemo(() => prepareModel(gltf), [gltf]);

  // Free the per-instance material clones.
  useEffect(() => () => model.materials.forEach((m) => m.dispose()), [model]);

  // Free the cached original when the viewer goes away. Deferred so React StrictMode's
  // simulated unmount/remount (development only) does not tear the model down.
  useEffect(() => {
    clearTimeout(pendingDispose.get(gltf));
    return () => pendingDispose.set(gltf, setTimeout(() => disposeGltf(gltf, url), 0));
  }, [gltf, url]);

  useEffect(() => {
    applyVisibility(model.scene, rules);
    invalidate();
  }, [model, rules, invalidate]);

  const { colorHex, preset, materialNames } = look;
  useEffect(() => {
    onInfo?.(applyLook(model.materials, { colorHex, preset, materialNames }));
    invalidate();
  }, [model, colorHex, preset, materialNames, onInfo, invalidate]);

  useEffect(() => { onReady?.(); }, [model, onReady]);

  return (
    <group scale={model.fit.scale}>
      <primitive object={model.scene} position={model.fit.offset} />
    </group>
  );
}

class ViewerErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error) { console.warn('[3D viewer] model failed to load:', error?.message); }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) return this.props.fallback(() => this.setState({ error: null }));
    return this.props.children;
  }
}

function Message({ icon: Icon = AlertTriangle, title, text, action }) {
  return (
    <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Icon className="h-9 w-9 text-muted" aria-hidden="true" />
      <p className="font-sans text-base font-semibold">{title}</p>
      {text && <p className="max-w-sm text-sm text-muted">{text}</p>}
      {action}
    </div>
  );
}

const toolBtn = 'flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white/90 text-ink shadow-sm backdrop-blur hover:bg-white focus-visible:outline-brand';

/**
 * Reusable 3D garment viewer (React Three Fiber).
 * @param {object} props
 * @param {string|null} props.url GLB/GLTF URL (API URL or blob: URL). Null shows the "no model" state.
 * @param {string} props.name Product name (accessibility label)
 * @param {{colorHex:string|null, preset:object|null, materialNames:string[]}} props.look
 * @param {{show:string[], hide:string[]}[]} props.rules ordered node visibility rules
 * @param {(info:{editable:number, sheenCapable:number, total:number})=>void} [props.onInfo]
 */
export default function GarmentViewer({ url, name = 'garment', look, rules, onInfo, className = '' }) {
  const webgl = useMemo(hasWebGL, []);
  const controlsRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [lost, setLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const markReady = useCallback(() => setReady(true), []);

  useEffect(() => { setReady(false); setLost(false); }, [url]);
  useEffect(() => { if (ready) controlsRef.current?.saveState(); }, [ready]);

  const zoom = (factor) => {
    const c = controlsRef.current;
    if (!c) return;
    const offset = c.object.position.clone().sub(c.target).multiplyScalar(factor);
    c.object.position.copy(c.target).add(offset);
    c.update();
  };

  const wrapper = `relative h-full w-full overflow-hidden rounded-2xl bg-gradient-to-b from-[#F4F2EF] to-[#E4DFD8] ${className}`;
  if (!url) return <div className={wrapper}><Message icon={Box} title="No 3D model available" text="This product does not have a 3D model yet." /></div>;
  if (!webgl) return <div className={wrapper}><Message title="3D preview is not supported" text="Your browser or device does not support WebGL, which the 3D studio needs. Try another browser or device." /></div>;
  if (lost) {
    return (
      <div className={wrapper}>
        <Message title="The 3D view was interrupted" text="The graphics context was lost, which can happen on low-memory devices."
          action={<button onClick={() => { setLost(false); setReady(false); setCanvasKey((k) => k + 1); }} className="h-10 rounded-full border border-line bg-white px-5 text-sm font-medium hover:bg-sand">Reload viewer</button>} />
      </div>
    );
  }

  return (
    <div className={wrapper} role="group" aria-label={`Interactive 3D preview of ${name}. Drag to rotate, scroll or pinch to zoom, two fingers or right mouse button to pan.`}>
      <ViewerErrorBoundary
        resetKey={url}
        fallback={(retry) => (
          <Message title="This 3D model could not be loaded" text="The file may be missing, damaged or use an unsupported format."
            action={<button onClick={() => { useGLTF.clear(url); retry(); }} className="h-10 rounded-full border border-line bg-white px-5 text-sm font-medium hover:bg-sand">Try again</button>} />
        )}
      >
        <Canvas
          key={canvasKey}
          frameloop={autoRotate ? 'always' : 'demand'}
          dpr={[1, 2]}
          camera={{ position: [0, 0.35, 4.6], fov: 35, near: 0.1, far: 100 }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setLost(true); })}
        >
          <ambientLight intensity={0.35} />
          <directionalLight position={[3, 5, 4]} intensity={1.4} />
          <directionalLight position={[-4, 2, -3]} intensity={0.5} />
          {/* Procedural studio lighting: no HDR file is downloaded from a third party. */}
          <Environment resolution={256}>
            <Lightformer form="rect" intensity={2.2} position={[0, 4, 4]} scale={[8, 3, 1]} />
            <Lightformer form="rect" intensity={1.2} position={[-5, 1, 0]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} />
            <Lightformer form="rect" intensity={1.2} position={[5, 1, 0]} rotation-y={-Math.PI / 2} scale={[6, 3, 1]} />
            <Lightformer form="ring" intensity={0.8} position={[0, 1, -5]} scale={4} />
          </Environment>
          <Suspense fallback={null}>
            <GarmentModel url={url} look={look} rules={rules} onInfo={onInfo} onReady={markReady} />
          </Suspense>
          <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} enablePan screenSpacePanning
            minDistance={1.8} maxDistance={8} autoRotate={autoRotate} autoRotateSpeed={1.4} />
        </Canvas>

        {!ready && (
          <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />Loading 3D model…
          </div>
        )}

        <div className="absolute bottom-3 right-3 flex flex-col gap-2 sm:bottom-4 sm:right-4">
          <button type="button" className={toolBtn} onClick={() => zoom(0.8)} aria-label="Zoom in" disabled={!ready}><ZoomIn className="h-5 w-5" aria-hidden="true" /></button>
          <button type="button" className={toolBtn} onClick={() => zoom(1.25)} aria-label="Zoom out" disabled={!ready}><ZoomOut className="h-5 w-5" aria-hidden="true" /></button>
          <button type="button" className={`${toolBtn} ${autoRotate ? 'ring-2 ring-brand' : ''}`} onClick={() => setAutoRotate((a) => !a)} aria-pressed={autoRotate} aria-label="Auto-rotate" disabled={!ready}><RotateCw className="h-5 w-5" aria-hidden="true" /></button>
          <button type="button" className={toolBtn} onClick={() => controlsRef.current?.reset()} aria-label="Reset camera" disabled={!ready}><RotateCcw className="h-5 w-5" aria-hidden="true" /></button>
        </div>
        {ready && <p className="pointer-events-none absolute bottom-3 left-4 hidden text-xs text-muted sm:block">Drag to rotate · Scroll to zoom · Right-drag to pan</p>}
      </ViewerErrorBoundary>
    </div>
  );
}
