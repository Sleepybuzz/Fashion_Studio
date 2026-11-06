import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Download, Trash2 } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { EmptyState, ErrorMessage, Notice, Spinner } from '../../components/ui/Feedback.jsx';
import PrivateImage from '../virtual-tryon/PrivateImage.jsx';
import { arService } from '../../services/ar.service.js';
import { parseError, imageSrc } from '../../services/api.js';

/** Customer area: AR screenshots the customer chose to save (/account/ar-captures). */
export default function MyArCapturesPage() {
  const qc = useQueryClient();
  const [toDelete, setToDelete] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [msg, setMsg] = useState(null);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['ar-captures'], queryFn: arService.list });
  const refresh = () => qc.invalidateQueries({ queryKey: ['ar-captures'] });

  const del = useMutation({
    mutationFn: (id) => arService.remove(id),
    onSuccess: () => { setToDelete(null); refresh(); },
    onError: (e) => { setMsg({ type: 'error', text: parseError(e).message }); setToDelete(null); },
  });
  const delAll = useMutation({
    mutationFn: arService.removeAll,
    onSuccess: (r) => { setConfirmAll(false); refresh(); setMsg({ type: 'success', text: `Deleted ${r.deleted} screenshot${r.deleted === 1 ? '' : 's'} from our servers.` }); },
    onError: (e) => { setMsg({ type: 'error', text: parseError(e).message }); setConfirmAll(false); },
  });

  if (isLoading) return <Spinner />;
  if (isError) return <ErrorMessage message="Could not load your AR captures." onRetry={refetch} />;

  return (
    <div>
      <h2 className="font-sans text-xl font-semibold">My AR captures</h2>
      <p className="mt-1 text-sm text-muted">Screenshots you chose to save from Real-Time AR Try-On. Only you can see them. They are deleted automatically after {data.retentionDays} days. Live camera pictures are never stored.</p>
      {msg && <div className="mt-4"><Notice type={msg.type}>{msg.text}</Notice></div>}

      {!data.items.length ? (
        <div className="mt-6"><EmptyState icon={Camera} title="No saved AR captures" text="Open a product that offers Real-Time AR Try-On, take a screenshot and choose “Save to my account”." action={<Button to="/shop" size="sm">Browse products</Button>} /></div>
      ) : (
        <>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((c) => (
              <li key={c.id} className="card flex flex-col overflow-hidden">
                <div className="aspect-[4/5] w-full bg-sand">
                  <PrivateImage src={c.imageUrl} alt={`AR preview of ${c.product.name}`} onExpired={refresh} loading="lazy" className="h-full w-full object-cover" />
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <p className="truncate font-medium">{c.product.name}</p>
                  <p className="text-xs text-muted">{new Date(c.createdAt).toLocaleDateString()} · deleted on {new Date(c.expiresAt).toLocaleDateString()}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {c.product.slug && <Button to={`/ar-try-on/${c.product.slug}`} size="sm" variant="outline">Try again</Button>}
                    <a href={`${imageSrc(c.imageUrl)}&dl=1`} aria-label={`Download AR preview of ${c.product.name}`} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-sand"><Download className="h-4 w-4" aria-hidden="true" /></a>
                    <button onClick={() => setToDelete(c)} aria-label={`Delete AR preview of ${c.product.name}`} className="flex h-9 w-9 items-center justify-center rounded-full text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-8 rounded-2xl border border-line bg-white p-4 text-sm">
            <p className="font-medium">Delete all my AR captures</p>
            <p className="mt-1 text-muted">Removes every saved screenshot from our servers.</p>
            <Button className="mt-3" variant="danger" size="sm" onClick={() => setConfirmAll(true)}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete everything</Button>
          </div>
        </>
      )}
      <p className="mt-6 text-xs text-muted">Looking for AI-generated photos? See <Link to="/account/try-ons" className="underline">Try-ons</Link>.</p>

      <ConfirmDialog open={!!toDelete} title="Delete this screenshot?" message="It will be permanently deleted from our servers." loading={del.isPending} onConfirm={() => del.mutate(toDelete.id)} onCancel={() => setToDelete(null)} />
      <ConfirmDialog open={confirmAll} title="Delete all AR captures?" confirmLabel="Delete everything" message="All your saved AR screenshots will be permanently deleted. This cannot be undone." loading={delAll.isPending} onConfirm={() => delAll.mutate()} onCancel={() => setConfirmAll(false)} />
    </div>
  );
}
