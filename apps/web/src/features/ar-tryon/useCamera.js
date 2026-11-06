import { useCallback, useEffect, useRef, useState } from 'react';
import { buildConstraints, classifyCameraError, isMirrored } from './cameraUtils.js';

/**
 * Camera lifecycle for the AR workspace. Nothing happens until `start()` is called (after the customer pressed
 * "Start camera"). Every track is stopped on `stop()`, on unmount and when the page is hidden for good (pagehide).
 * The stream is attached to a <video> only; frames are never recorded or sent anywhere by this hook.
 */
export function useCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const attempt = useRef(0);
  const [state, setState] = useState({ status: 'idle', facing: 'user', mirrored: true, problem: null, hasMultiple: false, videoSize: null });

  const stop = useCallback(() => {
    attempt.current += 1; // invalidates any start() still awaiting the browser
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) { v.pause(); v.srcObject = null; }
  }, []);

  const start = useCallback(async (facing = 'user') => {
    stop();
    const mine = attempt.current;
    setState((s) => ({ ...s, status: 'starting', problem: null, facing }));
    const secure = window.isSecureContext !== false;
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'SecurityError' });
      try {
        stream = await navigator.mediaDevices.getUserMedia(buildConstraints(facing));
      } catch (err) {
        if (err?.name !== 'OverconstrainedError' && err?.name !== 'ConstraintNotSatisfiedError') throw err;
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); // relax and retry once
      }
      if (mine !== attempt.current) { stream.getTracks().forEach((t) => t.stop()); return; } // user left / restarted meanwhile
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      track.addEventListener('ended', () => {
        if (streamRef.current !== stream) return;
        stop();
        setState((s) => ({ ...s, status: 'error', problem: classifyCameraError({ name: 'camera_lost' }) }));
      });
      const video = videoRef.current;
      if (!video) { stop(); return; }
      video.srcObject = stream;
      await video.play();
      if (mine !== attempt.current) return;
      let multiple = false;
      try { multiple = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length > 1; } catch { /* labels/devices unavailable */ }
      const settings = track.getSettings?.() || {};
      setState((s) => ({
        ...s, status: 'running', facing, mirrored: isMirrored(settings.facingMode, facing), hasMultiple: multiple,
        videoSize: { w: video.videoWidth, h: video.videoHeight },
      }));
    } catch (err) {
      if (mine !== attempt.current) return;
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setState((s) => ({ ...s, status: 'error', problem: classifyCameraError(err, { isSecureContext: secure }) }));
    }
  }, [stop]);

  const switchCamera = useCallback(() => start(state.facing === 'user' ? 'environment' : 'user'), [start, state.facing]);

  // Phones change the frame size when rotated.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    const onResize = () => { if (v.videoWidth) setState((s) => ({ ...s, videoSize: { w: v.videoWidth, h: v.videoHeight } })); };
    v.addEventListener('resize', onResize);
    return () => v.removeEventListener('resize', onResize);
  }, []);

  // Release the camera when leaving the page, even if React does not get to unmount.
  useEffect(() => {
    window.addEventListener('pagehide', stop);
    return () => { window.removeEventListener('pagehide', stop); stop(); };
  }, [stop]);

  return { videoRef, ...state, start, stop, switchCamera };
}
