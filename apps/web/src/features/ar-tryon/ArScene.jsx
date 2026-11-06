import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { applyLook, applyVisibility, disposeGltf, pendingDispose, prepareModel } from '../garment-studio/GarmentViewer.jsx';
import { computePlacement, fitGarment } from './arMath.js';

/**
 * Pixel-space AR layer. The orthographic camera maps 1 world unit = 1 CSS pixel of the stage, so a body point at
 * stage pixel (px, py) is world (px - W/2, H/2 - py). The garment is NOT a physical simulation: it is a rigid model
 * or image scaled, rotated and moved to follow the shoulders. It is always drawn on top of the video (no occlusion).
 */

/** Exposes invalidate() and capture() to the workspace without React state. */
function Bridge({ apiRef }) {
  const { gl, scene, camera, invalidate } = useThree();
  useEffect(() => {
    apiRef.current = {
      invalidate,
      /** Render once, synchronously, and return the canvas so the pixels are still valid for drawImage. */
      grabCanvas: () => { gl.render(scene, camera); return gl.domElement; },
    };
    return () => { apiRef.current = null; };
  }, [gl, scene, camera, invalidate, apiRef]);
  return null;
}

/**
 * Moves its children to follow the latest pose. Children must have their TOP-CENTRE at the local origin and
 * natural size (srcW x srcH world units).
 */
function GarmentRig({ poseRef, cfg, srcW, srcH, children }) {
  const pivot = useRef(null);
  const yaw = useRef(null);
  const inner = useRef(null);
  useFrame(({ size }) => {
    const p = poseRef.current;
    const g = pivot.current;
    if (!g) return;
    if (!p?.pose) { g.visible = false; return; }
    const pl = computePlacement(p.pose, cfg);
    const fit = fitGarment(srcW, srcH, pl);
    if (!(fit.scale > 0) || !Number.isFinite(fit.scale)) { g.visible = false; return; }
    g.visible = true;
    g.position.set(pl.pivot.x - size.width / 2, size.height / 2 - pl.pivot.y, 0);
    g.rotation.z = pl.rollRad;
    yaw.current.rotation.y = pl.yawRad;
    inner.current.position.y = pl.topLocalY;
    inner.current.scale.setScalar(fit.scale);
  });
  return (
    <group ref={pivot} visible={false}>
      <group ref={yaw}><group ref={inner}>{children}</group></group>
    </group>
  );
}

/** A GLB/GLTF garment from Phase 2, with Phase 2's colour / material / style logic applied unchanged. */
function Model3D({ url, look, rules, poseRef, cfg, onInfo, onReady }) {
  const gltf = useGLTF(url, false); // no Draco: its decoder would be fetched from a third-party CDN
  const invalidate = useThree((s) => s.invalidate);
  const model = useMemo(() => prepareModel(gltf), [gltf]);
  const bounds = useMemo(() => {
    // Size comes from the whole file (hidden style nodes included) so toggling a style option never rescales the garment.
    const box = new THREE.Box3().setFromObject(model.scene);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    if (box.isEmpty() || !(size.x > 0 && size.y > 0) || ![size.x, size.y, size.z].every(Number.isFinite)) {
      throw Object.assign(new Error('This 3D model has no usable size.'), { code: 'bad_asset' });
    }
    return { w: size.x, h: size.y, anchor: [-c.x, -box.max.y, -c.z] };
  }, [model]);

  useEffect(() => () => model.materials.forEach((m) => m.dispose()), [model]);
  useEffect(() => { // deferred like Phase 2 so React StrictMode's fake unmount does not drop the cache
    clearTimeout(pendingDispose.get(gltf));
    return () => pendingDispose.set(gltf, setTimeout(() => disposeGltf(gltf, url), 0));
  }, [gltf, url]);

  useEffect(() => { applyVisibility(model.scene, rules); invalidate(); }, [model, rules, invalidate]);
  const { colorHex, preset, materialNames } = look;
  useEffect(() => { onInfo?.(applyLook(model.materials, { colorHex, preset, materialNames })); invalidate(); }, [model, colorHex, preset, materialNames, onInfo, invalidate]);
  useEffect(() => { onReady?.(); }, [model, onReady]);

  return (
    <GarmentRig poseRef={poseRef} cfg={cfg} srcW={bounds.w} srcH={bounds.h}>
      <primitive object={model.scene} position={bounds.anchor} />
    </GarmentRig>
  );
}

/** A transparent PNG/WebP garment image. Aspect ratio is preserved; colour customization is not offered for images. */
function Overlay2D({ url, width, height, poseRef, cfg, onReady, onError }) {
  const invalidate = useThree((s) => s.invalidate);
  const [tex, setTex] = useState(null);
  useEffect(() => {
    let alive = true;
    let loaded = null;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(url, (t) => {
      if (!alive) { t.dispose(); return; }
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      loaded = t;
      setTex(t);
      onReady?.();
    }, undefined, () => alive && onError?.(new Error('The garment image could not be loaded.')));
    return () => { alive = false; loaded?.dispose(); setTex(null); };
  }, [url, onReady, onError]);
  useEffect(() => { invalidate(); }, [tex, invalidate]);
  // The mesh only exists once the image is loaded, so a blank white rectangle is never drawn over the customer.
  return (
    <GarmentRig poseRef={poseRef} cfg={cfg} srcW={width} srcH={height}>
      {tex && (
        <mesh position={[0, -height / 2, 0]}>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </GarmentRig>
  );
}

class SceneBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { this.props.onError?.(error); }
  render() { return this.state.error ? null : this.props.children; }
}

/**
 * @param {object} props
 * @param {{current:object|null}} props.poseRef latest smoothed pose from the tracker
 * @param {{current:object|null}} props.apiRef receives { invalidate, grabCanvas }
 * @param {{mode:'model3d'|'overlay2d', url:string, overlay?:{width:number,height:number}, cfg:object}} props.asset
 * @param {boolean} props.lowQuality render at device-pixel-ratio 1
 */
export default function ArScene({ poseRef, apiRef, asset, look, rules, lowQuality, onInfo, onReady, onError, onContextLost }) {
  return (
    <Canvas
      orthographic
      frameloop="demand"
      dpr={lowQuality ? 1 : [1, 1.5]}
      camera={{ position: [0, 0, 600], near: 0.1, far: 3000, zoom: 1 }}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onContextLost?.(); });
      }}
    >
      <Bridge apiRef={apiRef} />
      <SceneBoundary onError={onError}>
        {asset.mode === 'model3d' ? (
          <>
            <ambientLight intensity={0.55} />
            <directionalLight position={[200, 400, 600]} intensity={1.3} />
            <directionalLight position={[-300, 100, 300]} intensity={0.4} />
            <Environment resolution={128}>
              <Lightformer form="rect" intensity={2} position={[0, 4, 4]} scale={[8, 3, 1]} />
              <Lightformer form="rect" intensity={1} position={[-5, 1, 0]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} />
              <Lightformer form="rect" intensity={1} position={[5, 1, 0]} rotation-y={-Math.PI / 2} scale={[6, 3, 1]} />
            </Environment>
            <Suspense fallback={null}>
              <Model3D url={asset.url} look={look} rules={rules} poseRef={poseRef} cfg={asset.cfg} onInfo={onInfo} onReady={onReady} />
            </Suspense>
          </>
        ) : (
          <Overlay2D url={asset.url} width={asset.overlay.width} height={asset.overlay.height} poseRef={poseRef} cfg={asset.cfg} onReady={onReady} onError={onError} />
        )}
      </SceneBoundary>
    </Canvas>
  );
}
