import { ShieldCheck } from 'lucide-react';

/** Consent text built by the API from the ACTIVE providers. Nothing is sent to any AI service before the box is ticked. */
export default function ConsentBox({ consent, checked, onChange, disabled }) {
  return (
    <section className="card p-5 sm:p-6" aria-labelledby="ai-consent">
      <h2 id="ai-consent" className="flex items-center gap-2 font-sans text-base font-semibold"><ShieldCheck className="h-5 w-5 text-brand" aria-hidden="true" />Privacy and consent</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted">
        {consent.points.map((p) => <li key={p}>{p}</li>)}
      </ul>
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-sand p-3 text-sm">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#7952A3]" />
        <span>{consent.checkboxLabel}</span>
      </label>
    </section>
  );
}

export const VIEW_OPTIONS = [
  ['front', 'Front'],
  ['back', 'Back'],
  ['side', 'Side'],
  ['flat_lay', 'Laid flat'],
  ['unknown', 'Not sure'],
];

/** Which side of the garment the image shows. The assistant uses it to refuse edits to sides that are not visible. */
export function ViewSelect({ value, onChange, disabled }) {
  return (
    <div>
      <label htmlFor="ai-view" className="block text-sm font-medium">Which side of the garment does this image show?</label>
      <select id="ai-view" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-sm sm:w-64">
        {VIEW_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <p className="mt-1 text-xs text-muted">The AI can only edit what is visible. It will not guess the other side.</p>
    </div>
  );
}
