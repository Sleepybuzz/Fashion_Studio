import { useId } from 'react';

const base =
  'w-full rounded-xl border bg-white px-4 text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-sand';

/** Labelled form control. `as` can be 'input' | 'textarea' | 'select'. */
export default function FormField({ label, error, hint, as = 'input', className = '', children, ...props }) {
  const id = useId();
  const Tag = as;
  const size = as === 'textarea' ? 'py-3' : 'h-11';
  return (
    <div className={className}>
      {label && <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>}
      <Tag
        id={id}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className={`${base} ${size} ${error ? 'border-red-500' : 'border-line'}`}
        {...props}
      >
        {children}
      </Tag>
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
