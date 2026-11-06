import { useEffect, useRef, useState } from 'react';
import { PoseSmoother, analyzeUpperBody } from './arMath.js';
import { createPoseTracker, subscribeTrackerProgress } from './poseTracker.js';

const FAST_INTERVAL = 33; // ~30 detections per second at most
const SLOW_INTERVAL = 66; // used when inference is slow, to keep the page responsive
const GATE_SLACK = 6; // video frames arrive every ~33.3 ms with jitter; without slack about every second frame is skipped (=> ~15 fps)
const SLOW_ON_MS = 45;
const SLOW_OFF_MS = 25;

/**
 * Runs MediaPipe on the live <video> and publishes smoothed poses OUTSIDE React (via `onUpdate`) so that 30 updates a
 * second do not cause 30 React renders. Only coarse status changes are put into React state.
 * Frames are processed in memory and discarded; nothing is stored or uploaded.
 *
 * Two independent steps so they overlap instead of queueing:
 *   enabled -> the tracker (library + model) is loaded; this may start BEFORE the camera is running
 *   active  -> the camera is delivering frames, so the detection loop runs (needs the tracker to be ready)
 *
 * @param {{videoRef:{current:HTMLVideoElement|null}, enabled:boolean, active:boolean, paused:boolean,
 *   getStage:()=>({boxW:number, boxH:number, mirrored:boolean}), onUpdate:(out:object)=>void}} p
 */
export function usePoseTracking({ videoRef, enabled, active, paused, getStage, onUpdate }) {
  const [phase, setPhase] = useState({ status: 'idle', error: null, delegate: null });
  const [loadProgress, setLoadProgress] = useState({ pct: 0, label: 'Preparing…' });
  const [live, setLive] = useState({ state: 'lost', reason: 'no_body', hints: [], visible: {}, slow: false, ms: 0 });
  const [retryTick, setRetryTick] = useState(0);
  const trackerRef = useRef(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const cbRef = useRef({ getStage, onUpdate });
  cbRef.current = { getStage, onUpdate };

  // ---- A) load the tracker (independent of the camera)
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setPhase((p) => ({ ...p, status: 'loading', error: null }));
    const unsub = subscribeTrackerProgress((p) => setLoadProgress((o) => (o.pct === p.pct && o.label === p.label ? o : p)));
    createPoseTracker().then((t) => {
      if (cancelled) { t.close(); return; }
      trackerRef.current = t;
      setPhase({ status: 'running', error: null, delegate: t.delegate });
    }).catch((err) => {
      if (!cancelled) setPhase((p) => ({ ...p, status: 'error', error: err?.message || 'Body tracking could not be started' }));
    });
    return () => {
      cancelled = true;
      unsub();
      trackerRef.current?.close();
      trackerRef.current = null;
    };
  }, [enabled, retryTick]);

  // ---- B) detection loop: only while the camera delivers frames AND the tracker is ready
  const ready = enabled && active && phase.status === 'running';
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    let handle = 0;
    let usingVfc = false;
    const smoother = new PoseSmoother();
    let lastRun = 0;
    let lastVideoTime = -1;
    let interval = FAST_INTERVAL;
    let ema = 0;
    let frames = 0;
    let errors = 0;
    let lastSig = '';
    let lastPush = 0;
    let slowSince = 0;

    function schedule() {
      const v = videoRef.current;
      if (cancelled || !v) return;
      if (typeof v.requestVideoFrameCallback === 'function') { usingVfc = true; handle = v.requestVideoFrameCallback(tick); } else handle = requestAnimationFrame(tick);
    }

    function tick() {
      if (cancelled) return;
      const tracker = trackerRef.current;
      const video = videoRef.current;
      const now = performance.now();
      if (tracker && video && !pausedRef.current && !document.hidden && video.readyState >= 2 && video.videoWidth > 0
        && video.currentTime !== lastVideoTime && now - lastRun >= interval - GATE_SLACK) {
        lastRun = now;
        lastVideoTime = video.currentTime; // never run twice on the same frame (matters for the requestAnimationFrame fallback)
        try {
          const lm = tracker.detect(video);
          const took = performance.now() - now;
          ema = frames === 0 ? took : ema * 0.9 + took * 0.1;
          frames += 1;
          errors = 0;
          if (ema > SLOW_ON_MS) interval = SLOW_INTERVAL; else if (ema < SLOW_OFF_MS) interval = FAST_INTERVAL;

          const stage = cbRef.current.getStage();
          const a = analyzeUpperBody(lm, { srcW: video.videoWidth, srcH: video.videoHeight, boxW: stage.boxW, boxH: stage.boxH, mirrored: stage.mirrored });
          const out = smoother.update(a, now, stage);
          cbRef.current.onUpdate(out);

          if (ema > 60) slowSince ||= now; else slowSince = 0;
          const slow = slowSince > 0 && now - slowSince > 4000;
          const sig = `${out.state}|${out.reason}|${out.hints.join(',')}|${slow}|${out.visible.hips ? 1 : 0}${out.visible.elbows ? 1 : 0}${out.visible.wrists ? 1 : 0}`;
          if (sig !== lastSig || now - lastPush > 1500) {
            lastSig = sig; lastPush = now;
            setLive({ state: out.state, reason: out.reason, hints: out.hints, visible: out.visible, slow, ms: Math.round(ema) });
          }
        } catch {
          errors += 1;
          if (errors >= 8 && !cancelled) { setPhase((p) => ({ ...p, status: 'error', error: 'Body tracking stopped working. This can happen when the graphics memory runs out.' })); return; }
        }
      }
      schedule();
    }

    schedule();
    return () => {
      cancelled = true;
      const v = videoRef.current;
      if (usingVfc && v?.cancelVideoFrameCallback) v.cancelVideoFrameCallback(handle); else cancelAnimationFrame(handle);
    };
  }, [ready, videoRef]);

  return { ...phase, loadProgress, live, retry: () => setRetryTick((n) => n + 1) };
}