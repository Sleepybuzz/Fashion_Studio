import { Check, Info, LogIn, RotateCcw, Save } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import FormField from '../../components/ui/FormField.jsx';
import { Notice } from '../../components/ui/Feedback.jsx';

const chip = (on) => `min-h-[44px] rounded-full border px-4 text-sm transition-colors ${on ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:bg-sand'}`;

/**
 * Customization sidebar. Purely presentational: all state lives in GarmentStudioPage.
 */
export default function CustomizationPanel({
  studio, state, onColor, onMaterial, onOption, onReset,
  info, canSave, isCustomer, isGuest, loginState, onLogin,
  name, onName, editing, dirty, saving, onSave, onSaveAsNew, message, error, droppedNotice,
}) {
  const { colors, materials, options } = studio;
  const noEditable = info && info.editable === 0;

  return (
    <div className="space-y-6">
      {droppedNotice && <Notice type="error">Some choices in this saved design are no longer offered for this product and were reset.</Notice>}
      {noEditable && (
        <Notice type="error">
          Colour and material changes are unavailable for this model: none of its materials can be edited
          {studio.asset.customizableMaterials.length ? ' (the materials chosen by the store do not match the model).' : '.'}
        </Notice>
      )}

      <fieldset>
        <legend className="mb-2 flex w-full items-center justify-between text-sm font-medium">
          <span>Colour{state.colorKey && <span className="ml-2 font-normal text-muted">{colors.find((c) => c.key === state.colorKey)?.label}</span>}</span>
        </legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Colour">
          <button type="button" onClick={() => onColor(null)} aria-pressed={state.colorKey === null} disabled={noEditable}
            className={`${chip(state.colorKey === null)} disabled:opacity-40`}>Original</button>
          {colors.map((c) => (
            <button key={c.key} type="button" onClick={() => onColor(c.key)} aria-pressed={state.colorKey === c.key} aria-label={c.label} title={c.label} disabled={noEditable}
              className={`relative flex h-11 w-11 items-center justify-center rounded-full border-2 disabled:opacity-40 ${state.colorKey === c.key ? 'border-brand' : 'border-line'}`}
              style={{ backgroundColor: c.hex }}>
              {state.colorKey === c.key && <Check className="h-4 w-4 text-white mix-blend-difference" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Material finish</legend>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Material finish">
          <button type="button" onClick={() => onMaterial(null)} aria-pressed={state.materialKey === null} disabled={noEditable}
            className={`rounded-xl border p-3 text-left text-sm disabled:opacity-40 ${state.materialKey === null ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:bg-sand'}`}>
            <span className="block font-medium">Original</span><span className={`text-xs ${state.materialKey === null ? 'text-white/70' : 'text-muted'}`}>As in the model file</span>
          </button>
          {materials.map((m) => (
            <button key={m.key} type="button" onClick={() => onMaterial(m.key)} aria-pressed={state.materialKey === m.key} disabled={noEditable}
              className={`rounded-xl border p-3 text-left text-sm disabled:opacity-40 ${state.materialKey === m.key ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:bg-sand'}`}>
              <span className="block font-medium">{m.label}</span><span className={`text-xs ${state.materialKey === m.key ? 'text-white/70' : 'text-muted'}`}>{m.description}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {options.length > 0 ? options.map((o) => (
        <fieldset key={o.key}>
          <legend className="mb-2 text-sm font-medium">{o.label}</legend>
          <div className="flex flex-wrap gap-2" role="group" aria-label={o.label}>
            {o.values.map((v) => (
              <button key={v.key} type="button" onClick={() => onOption(o.key, v.key)} aria-pressed={state.selections[o.key] === v.key} className={chip(state.selections[o.key] === v.key)}>{v.label}</button>
            ))}
          </div>
        </fieldset>
      )) : (
        <p className="rounded-xl bg-sand px-4 py-3 text-sm text-muted">This model has no style options (sleeves, neckline, length). Only colour and material can be changed.</p>
      )}

      <Button variant="outline" size="sm" onClick={onReset}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reset customization</Button>

      <div className="rounded-2xl border border-line bg-white p-4">
        <h2 className="font-sans text-sm font-semibold">Save this design</h2>
        {isGuest && (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted">Log in or create an account to save and reopen your designs.</p>
            <Button to="/login" state={loginState} onClick={onLogin} size="sm"><LogIn className="h-4 w-4" aria-hidden="true" />Log in to save</Button>
          </div>
        )}
        {!isGuest && !isCustomer && <p className="mt-3 text-sm text-muted">Saved designs belong to customer accounts. As the store owner you can preview but not save.</p>}
        {canSave && (
          <div className="mt-3 space-y-3">
            <FormField label="Design name" value={name} onChange={(e) => onName(e.target.value)} maxLength={80} placeholder="e.g. Summer navy" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={saving} onClick={onSave}><Save className="h-4 w-4" aria-hidden="true" />{editing ? 'Update design' : 'Save design'}</Button>
              {editing && <Button size="sm" variant="outline" disabled={saving} onClick={onSaveAsNew}>Save as new</Button>}
            </div>
            {dirty && <p className="text-xs text-muted" aria-live="polite">You have unsaved changes.</p>}
            {message && <Notice>{message}</Notice>}
            {error && <Notice type="error">{error}</Notice>}
          </div>
        )}
      </div>

      <details className="rounded-2xl border border-line bg-white p-4 text-sm text-muted">
        <summary className="flex cursor-pointer items-center gap-2 font-medium text-ink"><Info className="h-4 w-4" aria-hidden="true" />About this preview</summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li>Colours tint the model&apos;s existing materials; textures keep their pattern.</li>
          <li>Material finishes change shininess and softness only. This is not a fabric or drape simulation.</li>
          <li>Style options show or hide parts that already exist in the 3D file; they do not reshape the garment.</li>
          <li>Screen colours vary by display and lighting, so the final product may look slightly different.</li>
          {info && info.editable > 0 && info.sheenCapable === 0 && <li>This model&apos;s materials do not support the soft-sheen effect, so only roughness and metalness change.</li>}
        </ul>
      </details>
    </div>
  );
}
