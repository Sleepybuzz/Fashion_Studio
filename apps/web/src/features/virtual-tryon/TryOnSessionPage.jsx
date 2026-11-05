import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bookmark, Check, Download, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { ErrorMessage, Notice, Spinner } from '../../components/ui/Feedback.jsx';
import { tryOnService } from '../../services/tryon.service.js';
import { API_URL, parseError } from '../../services/api.js';
import CompareView from './CompareView.jsx';

const STEPS = [
  { id: 'uploaded', label: 'Photo uploaded' },
  { id: 'validating', label: 'Validating' },
  { id: 'processing', label: 'Creating your try-on' },
  { id: 'completed', label: 'Done' },
];
const ACTIVE = ['validating', 'processing'];

function Progress({ status }) {
  const current = status === 'validating' ? 1 : status === 'processing' ? 2 : 3;
  return (
    <ol className="mx-auto max-w-sm space-y-3" aria-label="Progress">
      {STEPS.map((s, i) => {
        const done = i < current || status === 'completed';
        const active = i === current && status !== 'completed';
        return (
          <li key={s.id} className="flex items-center gap-3 text-sm" aria-current={active ? 'step' : undefined}>
            <span className={`flex h-7 w-7 items-center justify-center rounded-full border ${done ? 'border-leaf bg-leaf text-white' : active ? 'border-brand text-brand' : 'border-line text-muted'}`}>
              {done ? <Check className="h-4 w-4" aria-hidden="true" /> : active ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : i + 1}
            </span>
            <span className={active ? 'font-medium' : done ? '' : 'text-muted'}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** /account/try-ons/:id — progress, result, errors and actions for one try-on. Polls our API while it is running. */
export default function TryOnSessionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState('');

  const q = useQuery({
    queryKey: ['tryon-session', id],
    queryFn: () => tryOnService.get(id),
    retry: (n, err) => err?.response?.status !== 404 && n < 2,
    refetchInterval: (query) => (ACTIVE.includes(query.state.data?.status) ? 2000 : false),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['tryon-session', id] }); qc.invalidateQueries({ queryKey: ['tryon-sessions'] }); };
  const fail = (e) => setActionError(parseError(e).message);

  const retry = useMutation({ mutationFn: () => tryOnService.retry(id), onSuccess: () => { setActionError(''); refresh(); }, onError: fail });
  const save = useMutation({ mutationFn: (saved) => tryOnService.setSaved(id, saved), onSuccess: () => { setActionError(''); refresh(); }, onError: fail });
  const del = useMutation({
    mutationFn: () => tryOnService.remove(id),
    onSuccess: () => { qc.removeQueries({ queryKey: ['tryon-session', id] }); qc.invalidateQueries({ queryKey: ['tryon-sessions'] }); qc.invalidateQueries({ queryKey: ['tryon-config'] }); navigate('/account/try-ons', { replace: true }); },
    onError: (e) => { fail(e); setConfirmDelete(false); },
  });

  if (q.isLoading) return <Spinner />;
  if (q.error?.response?.status === 404) {
    return (
      <div className="py-10 text-center">
        <h2 className="font-sans text-xl font-semibold">Try-on not found</h2>
        <p className="mt-2 text-sm text-muted">It may have been deleted or expired.</p>
        <Link to="/account/try-ons" className="mt-4 inline-block font-medium text-brand hover:underline">My try-ons</Link>
      </div>
    );
  }
  if (q.isError) return <ErrorMessage message="Could not load this try-on." onRetry={q.refetch} />;

  const s = q.data;
  const active = ACTIVE.includes(s.status);

  return (
    <div>
      <Link to="/account/try-ons" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden="true" />My try-ons</Link>
      <h2 className="font-sans text-xl font-semibold">{s.product.name}</h2>
      <p className="mt-1 text-sm text-muted">Started {new Date(s.createdAt).toLocaleString()}</p>
      {actionError && <div className="mt-4"><Notice type="error">{actionError}</Notice></div>}

      {active && (
        <div className="card mt-6 p-6 text-center" role="status" aria-live="polite">
          <Progress status={s.status} />
          <p className="mt-5 text-sm text-muted">This usually takes under a minute. You can leave this page; your try-on will be in “My try-ons”.</p>
        </div>
      )}

      {s.status === 'failed' && (
        <div className="mt-6 space-y-4">
          <Notice type="error">{s.error?.message}</Notice>
          <div className="flex flex-wrap gap-2">
            {s.error?.canRetry && <Button onClick={() => retry.mutate()} loading={retry.isPending}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>}
            {s.product.slug && <Button variant="outline" to={`/try-on/${s.product.slug}`}>Use a different photo</Button>}
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete</Button>
          </div>
          <p className="text-xs text-muted">Attempt {s.attempts}. “Try again” re-sends your stored photo.</p>
        </div>
      )}

      {s.status === 'completed' && (
        <div className="mt-6 space-y-5">
          {s.isTest && <Notice type="error"><strong>Test mode.</strong> This image is your original photo returned unchanged by the provider's test mode. It is not an AI result.</Notice>}
          <CompareView beforeUrl={s.photoUrl} afterUrl={s.resultUrl} onExpired={refresh} />
          <p className="text-center text-xs text-muted">AI-generated image. It is an approximation and does not guarantee fit, size, colour or fabric drape.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant={s.saved ? 'brand' : 'outline'} onClick={() => save.mutate(!s.saved)} loading={save.isPending} aria-pressed={s.saved}>
              <Bookmark className={`h-4 w-4 ${s.saved ? 'fill-current' : ''}`} aria-hidden="true" />{s.saved ? 'Saved' : 'Save result'}
            </Button>
            <a href={`${API_URL}${s.resultUrl}&dl=1`} className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line bg-white px-5 text-sm font-medium hover:bg-sand"><Download className="h-4 w-4" aria-hidden="true" />Download</a>
            {s.product.slug && <Button variant="outline" to={`/shop/${s.product.slug}`}>View product</Button>}
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete</Button>
          </div>
          {s.expiresAt && <p className="text-center text-xs text-muted">{s.saved ? 'Saved until' : 'Will be deleted automatically on'} {new Date(s.expiresAt).toLocaleDateString()}. Save it to keep it longer.</p>}
        </div>
      )}

      <ConfirmDialog open={confirmDelete} title="Delete this try-on?" message="Your photo and the result will be permanently deleted from our servers."
        loading={del.isPending} onConfirm={() => del.mutate()} onCancel={() => setConfirmDelete(false)} />
    </div>
  );
}
