import { AlertCircle, CheckCircle2, Loader2, PackageOpen } from 'lucide-react';

export function Spinner({ label = 'Loading…', className = '' }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-2 py-16 text-sm text-muted ${className}`}>
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorMessage({ message = 'Something went wrong.', onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
      <AlertCircle className="h-6 w-6" aria-hidden="true" />
      <p>{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="rounded-full border border-red-300 bg-white px-4 py-1.5 font-medium hover:bg-red-100">
          Try again
        </button>
      )}
    </div>
  );
}

export function Notice({ type = 'success', children }) {
  const isOk = type === 'success';
  const Icon = isOk ? CheckCircle2 : AlertCircle;
  return (
    <div role={isOk ? 'status' : 'alert'} className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${isOk ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, text, icon: Icon = PackageOpen, action }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-white px-6 py-14 text-center">
      <Icon className="h-9 w-9 text-muted" aria-hidden="true" />
      <h3 className="font-sans text-base font-semibold">{title}</h3>
      {text && <p className="max-w-sm text-sm text-muted">{text}</p>}
      {action}
    </div>
  );
}
