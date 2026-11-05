import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Loader2, Shirt, Sparkles, Trash2 } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { EmptyState, ErrorMessage, Notice, Spinner } from '../../components/ui/Feedback.jsx';
import PrivateImage from '../virtual-tryon/PrivateImage.jsx';
import { tryOnService } from '../../services/tryon.service.js';
import { parseError } from '../../services/api.js';

const BADGE = {
  validating: ['Validating', 'bg-amber-100 text-amber-800'],
  processing: ['Processing', 'bg-amber-100 text-amber-800'],
  completed: ['Completed', 'bg-green-100 text-green-800'],
  failed: ['Failed', 'bg-red-100 text-red-700'],
};

/** Customer area: saved and recent virtual try-ons (/account/try-ons). */
export default function MyTryOnsPage() {
  const qc = useQueryClient();
  const [toDelete, setToDelete] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [msg, setMsg] = useState(null); // { type, text }
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['tryon-sessions'],
    queryFn: () => tryOnService.list({ limit: 50 }),
    refetchInterval: (q) => (q.state.data?.items.some((s) => s.status === 'validating' || s.status === 'processing') ? 4000 : false),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['tryon-sessions'] }); qc.invalidateQueries({ queryKey: ['tryon-config'] }); };

  const del = useMutation({
    mutationFn: (id) => tryOnService.remove(id),
    onSuccess: (_r, id) => { setToDelete(null); qc.removeQueries({ queryKey: ['tryon-session', id] }); refresh(); },
    onError: (e) => { setMsg({ type: 'error', text: parseError(e).message }); setToDelete(null); },
  });
  const delAll = useMutation({
    mutationFn: tryOnService.removeAll,
    onSuccess: (r) => {
      setConfirmAll(false); qc.removeQueries({ queryKey: ['tryon-session'] }); refresh();
      setMsg({ type: 'success', text: `Deleted ${r.deleted} try-on${r.deleted === 1 ? '' : 's'} from our servers.${r.providerErased ? ' We also asked the AI provider to erase the data it holds for you.' : ' We could not confirm erasure at the AI provider; its copies are deleted automatically within its retention period.'}` });
    },
    onError: (e) => { setMsg({ type: 'error', text: parseError(e).message }); setConfirmAll(false); },
  });
  const save = useMutation({
    mutationFn: ({ id, saved }) => tryOnService.setSaved(id, saved),
    onSuccess: refresh,
    onError: (e) => setMsg({ type: 'error', text: parseError(e).message }),
  });

  if (isLoading) return <Spinner />;
  if (isError) return <ErrorMessage message="Could not load your try-ons." onRetry={refetch} />;

  return (
    <div>
      <h2 className="font-sans text-xl font-semibold">My virtual try-ons</h2>
      <p className="mt-1 text-sm text-muted">Only you can see these. Results you do not save are deleted automatically.</p>
      {msg && <div className="mt-4"><Notice type={msg.type}>{msg.text}</Notice></div>}

      {!data.items.length ? (
        <div className="mt-6"><EmptyState icon={Sparkles} title="No try-ons yet" text="Open a product that offers virtual try-on and choose “Try it on with AI”." action={<Button to="/shop" size="sm">Browse products</Button>} /></div>
      ) : (
        <>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((s) => {
              const [label, cls] = BADGE[s.status];
              const thumb = s.status === 'completed' ? s.resultUrl : null;
              return (
                <li key={s.id} className="card flex flex-col overflow-hidden">
                  <Link to={`/account/try-ons/${s.id}`} className="block" aria-label={`Open try-on of ${s.product.name}`}>
                    <div className="relative aspect-[4/5] w-full bg-sand">
                      {thumb ? <PrivateImage src={thumb} alt="" onExpired={refresh} loading="lazy" className="h-full w-full object-cover" />
                        : <div className="flex h-full items-center justify-center text-muted">{s.status === 'failed' ? <Shirt className="h-10 w-10" aria-hidden="true" /> : <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />}</div>}
                      <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>{label}</span>
                    </div>
                  </Link>
                  <div className="flex flex-1 flex-col p-4">
                    <p className="truncate font-medium">{s.product.name}</p>
                    <p className="text-xs text-muted">{new Date(s.createdAt).toLocaleDateString()}{s.isTest ? ' · test mode' : ''}</p>
                    {s.expiresAt && s.status !== 'validating' && s.status !== 'processing' && <p className="text-xs text-muted">{s.saved ? 'Saved until' : 'Deleted on'} {new Date(s.expiresAt).toLocaleDateString()}</p>}
                    <div className="mt-3 flex items-center gap-2">
                      <Button to={`/account/try-ons/${s.id}`} size="sm" variant="outline">Open</Button>
                      {s.status === 'completed' && (
                        <button onClick={() => save.mutate({ id: s.id, saved: !s.saved })} aria-pressed={s.saved} aria-label={s.saved ? `Unsave try-on of ${s.product.name}` : `Save try-on of ${s.product.name}`}
                          className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-sand"><Bookmark className={`h-4 w-4 ${s.saved ? 'fill-brand text-brand' : ''}`} /></button>
                      )}
                      {(s.status === 'completed' || s.status === 'failed') && (
                        <button onClick={() => setToDelete(s)} aria-label={`Delete try-on of ${s.product.name}`} className="flex h-9 w-9 items-center justify-center rounded-full text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-8 rounded-2xl border border-line bg-white p-4 text-sm">
            <p className="font-medium">Delete all my try-ons</p>
            <p className="mt-1 text-muted">Removes every photo and result from our servers and asks the AI provider to erase the data it holds for you.</p>
            <Button className="mt-3" variant="danger" size="sm" onClick={() => setConfirmAll(true)}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete everything</Button>
          </div>
        </>
      )}

      <ConfirmDialog open={!!toDelete} title="Delete this try-on?" message="Your photo and the result will be permanently deleted from our servers."
        loading={del.isPending} onConfirm={() => del.mutate(toDelete.id)} onCancel={() => setToDelete(null)} />
      <ConfirmDialog open={confirmAll} title="Delete all try-ons?" confirmLabel="Delete everything" message="All your photos and results will be permanently deleted. This cannot be undone."
        loading={delAll.isPending} onConfirm={() => delAll.mutate()} onCancel={() => setConfirmAll(false)} />
    </div>
  );
}
