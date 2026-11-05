import { useState } from 'react';
import PrivateImage from './PrivateImage.jsx';

const MODES = [
  { id: 'slider', label: 'Slide to compare' },
  { id: 'side', label: 'Side by side' },
  { id: 'result', label: 'Result only' },
];

/** Original photo vs generated result. Fully keyboard accessible (the slider is a native range input). */
export default function CompareView({ beforeUrl, afterUrl, onExpired }) {
  const [mode, setMode] = useState('slider');
  const [pos, setPos] = useState(50);
  const [ratio, setRatio] = useState(4 / 5);
  const onLoad = (e) => { const { naturalWidth: w, naturalHeight: h } = e.currentTarget; if (w && h) setRatio(w / h); };

  return (
    <div>
      <div role="tablist" aria-label="Comparison view" className="mb-4 flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button key={m.id} role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)}
            className={`h-10 rounded-full px-4 text-sm ${mode === m.id ? 'bg-ink text-white' : 'border border-line bg-white hover:bg-sand'}`}>{m.label}</button>
        ))}
      </div>

      {mode === 'slider' && (
        <div className="mx-auto w-full max-w-lg">
          <div className="relative w-full select-none overflow-hidden rounded-2xl bg-sand" style={{ aspectRatio: ratio, maxHeight: '75vh' }}>
            <PrivateImage src={afterUrl} alt="Try-on result" onLoad={onLoad} onExpired={onExpired} draggable={false} className="absolute inset-0 h-full w-full object-cover" />
            <PrivateImage src={beforeUrl} alt="Your original photo" onExpired={onExpired} draggable={false} className="absolute inset-0 h-full w-full object-cover" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${pos}%` }}>
              <span className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-xs shadow">⇆</span>
            </div>
            <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">Original</span>
            <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">Try-on</span>
            <input type="range" min="0" max="100" value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Compare original photo and try-on result"
              className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0" style={{ touchAction: 'pan-y' }} />
          </div>
          <p className="mt-2 text-center text-xs text-muted">Drag across the image, or use the arrow keys, to compare.</p>
        </div>
      )}

      {mode === 'side' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <figure>
            <PrivateImage src={beforeUrl} alt="Your original photo" onExpired={onExpired} className="max-h-[75vh] w-full rounded-2xl bg-sand object-contain" />
            <figcaption className="mt-2 text-center text-sm text-muted">Original</figcaption>
          </figure>
          <figure>
            <PrivateImage src={afterUrl} alt="Try-on result" onExpired={onExpired} className="max-h-[75vh] w-full rounded-2xl bg-sand object-contain" />
            <figcaption className="mt-2 text-center text-sm text-muted">Try-on</figcaption>
          </figure>
        </div>
      )}

      {mode === 'result' && (
        <PrivateImage src={afterUrl} alt="Try-on result" onExpired={onExpired} className="mx-auto max-h-[75vh] w-full max-w-lg rounded-2xl bg-sand object-contain" />
      )}
    </div>
  );
}
