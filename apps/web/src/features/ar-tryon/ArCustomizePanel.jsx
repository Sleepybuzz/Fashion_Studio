import { Check, RotateCcw } from 'lucide-react';

const chip = (on) => `min-h-[40px] rounded-full border px-3.5 text-sm transition-colors ${on ? 'border-white bg-white text-neutral-900' : 'border-white/25 bg-white/5 text-white hover:bg-white/15'}`;

/**
 * Compact customization controls for the AR dock. State lives in ArTryOnPage and uses the SAME shape and helpers as the
 * Phase 2 studio ({colorKey, materialKey, selections}). Controls appear only when the model really supports them:
 * colour/material only if at least one material is editable, style options only if the store defined some.
 */
export default function ArCustomizePanel({ studio, state, info, onColor, onMaterial, onOption, onReset, dirty }) {
  const editable = !info || info.editable > 0;
  const hasStyle = studio.options.length > 0;
  if (!editable && !hasStyle) {
    return <p className="rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white/70">This garment has no options to change.</p>;
  }
  return (
    <div className="space-y-4">
      {editable && (
        <>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Colour{state.colorKey && <span className="ml-2 font-normal text-white/60">{studio.colors.find((c) => c.key === state.colorKey)?.label}</span>}</legend>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Colour">
              <button type="button" onClick={() => onColor(null)} aria-pressed={state.colorKey === null} className={chip(state.colorKey === null)}>Original</button>
              {studio.colors.map((c) => (
                <button key={c.key} type="button" onClick={() => onColor(c.key)} aria-pressed={state.colorKey === c.key} aria-label={c.label} title={c.label}
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 ${state.colorKey === c.key ? 'border-white' : 'border-white/30'}`} style={{ backgroundColor: c.hex }}>
                  {state.colorKey === c.key && <Check className="h-4 w-4 text-white mix-blend-difference" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Material finish</legend>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Material finish">
              <button type="button" onClick={() => onMaterial(null)} aria-pressed={state.materialKey === null} className={chip(state.materialKey === null)}>Original</button>
              {studio.materials.map((m) => (
                <button key={m.key} type="button" onClick={() => onMaterial(m.key)} aria-pressed={state.materialKey === m.key} className={chip(state.materialKey === m.key)}>{m.label}</button>
              ))}
            </div>
          </fieldset>
        </>
      )}
      {studio.options.map((o) => (
        <fieldset key={o.key}>
          <legend className="mb-2 text-sm font-medium">{o.label}</legend>
          <div className="flex flex-wrap gap-2" role="group" aria-label={o.label}>
            {o.values.map((v) => <button key={v.key} type="button" onClick={() => onOption(o.key, v.key)} aria-pressed={state.selections[o.key] === v.key} className={chip(state.selections[o.key] === v.key)}>{v.label}</button>)}
          </div>
        </fieldset>
      ))}
      <button type="button" onClick={onReset} disabled={!dirty} className="inline-flex h-10 items-center gap-2 rounded-full border border-white/25 px-4 text-sm hover:bg-white/10 disabled:opacity-40">
        <RotateCcw className="h-4 w-4" aria-hidden="true" />Reset to original
      </button>
    </div>
  );
}
