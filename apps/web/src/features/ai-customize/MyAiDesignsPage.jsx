import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Trash2, Upload } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { EmptyState, ErrorMessage, Notice, Spinner } from '../../components/ui/Feedback.jsx';
import PrivateImage from '../virtual-tryon/PrivateImage.jsx';
import { aiService } from '../../services/ai.service.js';
import { parseError } from '../../services/api.js';

export default function MyAiDesignsPage() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(null);
  const status = useQuery({ queryKey: ['ai-status'], queryFn: aiService.status });
  const sessions = useQuery({ queryKey: ['ai-sessions', 'all'], queryFn: () => aiService.sessions() });
  const saved = useQuery({ queryKey: ['ai-saved'], queryFn: aiService.saved });
  const done = () => { setConfirm(null); qc.invalidateQueries({ queryKey: ['ai-sessions'] }); qc.invalidateQueries({ queryKey: ['ai-saved'] }); };
  const del = useMutation({
    mutationFn: (c) => (c.kind === 'all' ? aiService.removeAll() : c.kind === 'saved' ? aiService.removeSaved(c.id) : aiService.removeSession(c.id)),
    onSuccess: done, onError: () => setConfirm(null),
  });

  if (sessions.isLoading || saved.isLoading) return <Spinner />;
  if (sessions.isError || saved.isError) return <ErrorMessage message="We could not load your AI designs." onRetry={() => { sessions.refetch(); saved.refetch(); }} />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-sans text-xl font-semibold">My AI designs</h2>
        <div className="flex gap-2">
          {status.data?.customizationAvailable && <Button to="/customize/upload" size="sm"><Upload className="h-4 w-4" aria-hidden="true" />Customize my own photo</Button>}
          {sessions.data.length > 0 && <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'all' })}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete all</Button>}
        </div>
      </div>
      {del.isError && <div className="mt-3"><Notice type="error">{parseError(del.error).message}</Notice></div>}
      <p className="mt-2 text-sm text-muted">Sessions are private to you. Unsaved sessions are deleted automatically after a few days.</p>

      <h3 className="mt-6 font-sans text-base font-semibold">Saved designs</h3>
      {saved.data.length === 0 ? <p className="mt-2 text-sm text-muted">No saved designs yet.</p> : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {saved.data.map((d) => (
            <li key={d.id} className="card overflow-hidden">
              <Link to={`/customize/session/${d.sessionId}`} className="block">
                {d.imageUrl ? <PrivateImage src={d.imageUrl} alt={d.title} className="aspect-[4/5] w-full bg-sand object-cover" /> : <div className="flex aspect-[4/5] items-center justify-center bg-sand text-xs text-muted">3D design</div>}
                <p className="truncate px-3 pt-2 text-sm font-medium">{d.title}</p>
              </Link>
              <div className="flex items-center justify-between px-3 pb-2 text-xs text-muted">v{d.versionNumber}
                <button className="inline-flex h-11 w-11 items-center justify-center" aria-label={`Delete saved design ${d.title}`} onClick={() => setConfirm({ kind: 'saved', id: d.id })}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-8 font-sans text-base font-semibold">Sessions</h3>
      {sessions.data.length === 0 ? (
        <EmptyState icon={Sparkles} title="No AI sessions yet" text="Open a product and choose “AI Chat & Customize This Product”, or upload your own garment photo." />
      ) : (
        <ul className="mt-3 space-y-2">
          {sessions.data.map((x) => (
            <li key={x.id} className="card flex items-center gap-3 p-3">
              <Link to={`/customize/session/${x.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <PrivateImage src={x.thumbnailUrl} alt="" className="h-16 w-14 shrink-0 rounded-lg bg-sand object-cover" />
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{x.title}</span>
                  <span className="block text-xs text-muted">{x.type === 'upload' ? 'Your photo' : x.productName} · {x.versionCount} version{x.versionCount === 1 ? '' : 's'}</span></span>
              </Link>
              <button className="inline-flex h-11 w-11 shrink-0 items-center justify-center" aria-label={`Delete session ${x.title}`} onClick={() => setConfirm({ kind: 'session', id: x.id })}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog open={!!confirm} loading={del.isPending}
        title={confirm?.kind === 'all' ? 'Delete all AI sessions?' : confirm?.kind === 'saved' ? 'Delete this saved design?' : 'Delete this session?'}
        message="This permanently deletes the images and chat." onCancel={() => setConfirm(null)} onConfirm={() => del.mutate(confirm)} />
    </div>
  );
}
