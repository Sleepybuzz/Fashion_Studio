import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bookmark, Check, History, Loader2, RotateCcw, Send, Sparkles, Trash2, X } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { ErrorMessage, Notice, Spinner } from '../../components/ui/Feedback.jsx';
import PrivateImage from '../virtual-tryon/PrivateImage.jsx';
import { aiService } from '../../services/ai.service.js';
import { parseError } from '../../services/api.js';

const newRequestId = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function TryOnPanel({ sessionId, versionId, enabled }) {
  const q = useQuery({ queryKey: ['ai-methods', sessionId, versionId], queryFn: () => aiService.tryOnMethods(sessionId, versionId), enabled });
  if (!enabled) return null;
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="tryon-methods">
      <h2 id="tryon-methods" className="font-sans text-base font-semibold">Try it on</h2>
      {q.isLoading && <p className="mt-2 text-sm text-muted">Checking what is available…</p>}
      {q.isError && <p className="mt-2 text-sm text-red-700">Could not check try-on options.</p>}
      <ul className="mt-3 space-y-3">
        {q.data?.methods.map((m) => (
          <li key={m.id} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{m.label}</span>
              {m.available && m.path
                ? <Link to={m.path} className="inline-flex min-h-[44px] items-center rounded-full bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark">Open</Link>
                : <span className="text-xs text-muted">Not available</span>}
            </div>
            <p className="mt-1 text-xs text-muted">{m.available ? m.note || 'Available.' : m.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CustomizeSessionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const endRef = useRef(null);
  const [text, setText] = useState('');
  const [pendingId, setPendingId] = useState(null); // reused only after a network failure with no response
  const [confirm, setConfirm] = useState(null);
  const [notice, setNotice] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);

  const q = useQuery({
    queryKey: ['ai-session', id], queryFn: () => aiService.session(id),
    refetchInterval: (query) => (query.state.data?.busy ? 3000 : false),
  });
  const s = q.data;
  const setSession = (session) => { qc.setQueryData(['ai-session', id], session); qc.invalidateQueries({ queryKey: ['ai-methods', id] }); qc.invalidateQueries({ queryKey: ['ai-sessions'] }); };

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [s?.messages?.length, s?.busy]);

  const send = useMutation({
    mutationFn: () => {
      const rid = pendingId || newRequestId();
      setPendingId(rid);
      return aiService.send(id, text.trim(), rid);
    },
    onSuccess: (session) => { setSession(session); setText(''); setPendingId(null); },
    onError: (e) => { if (e?.response) setPendingId(null); }, // server answered: next send is a new request
  });
  const act = (fn, okMsg) => useMutation({ mutationFn: fn, onSuccess: (r) => { if (r?.id) setSession(r); setNotice(okMsg); setConfirm(null); }, onError: () => setConfirm(null) });
  const restore = act((vid) => aiService.restore(id, vid), 'Version restored.');
  const restoreOrig = act(() => aiService.restoreOriginal(id), 'Back to the original.');
  const removeVer = act((vid) => aiService.removeVersion(id, vid), 'Version deleted.');
  const save = act((vid) => aiService.save(id, { versionId: vid }).then(() => aiService.session(id)), 'Design saved to My AI designs.');
  const removeSession = useMutation({
    mutationFn: () => aiService.removeSession(id),
    onSuccess: () => { qc.removeQueries({ queryKey: ['ai-session', id] }); qc.invalidateQueries({ queryKey: ['ai-sessions'] }); navigate('/account/ai-designs', { replace: true }); },
  });

  const versions = useMemo(() => [...(s?.versions || [])].reverse(), [s?.versions]);
  const current = s?.versions.find((v) => v.isCurrent);
  const mutErr = [send, restore, restoreOrig, removeVer, save, removeSession].find((m) => m.isError)?.error;

  if (q.isLoading) return <Spinner />;
  if (q.isError) return <div className="container-page py-12"><ErrorMessage message={parseError(q.error).message} onRetry={q.refetch} /></div>;

  const canSend = text.trim().length > 0 && !s.busy && !send.isPending && s.status === 'active';
  const refresh = () => q.refetch();

  return (
    <div className="container-page py-6 sm:py-10">
      <Link to={s.type === 'product' && s.product ? `/shop/${s.product.slug}` : '/account/ai-designs'} className="mb-4 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back</Link>
      <h1 className="h-section">{s.title}</h1>
      <p className="mt-1 text-sm text-muted">Design concept made with AI. Results can contain mistakes and are not guaranteed to match your request.</p>

      {notice && <div className="mt-4" onClick={() => setNotice('')}><Notice>{notice}</Notice></div>}
      {mutErr && <div className="mt-4"><Notice type="error">{parseError(mutErr).message}</Notice></div>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10">
        {/* Preview + history */}
        <div className="min-w-0 space-y-5">
          <div className="relative overflow-hidden rounded-2xl bg-sand">
            <PrivateImage src={showOriginal ? s.originalUrl : s.previewUrl} alt={showOriginal || s.previewIsOriginal ? 'Original garment' : 'Current design'} onExpired={refresh} className="mx-auto max-h-[70vh] w-auto max-w-full object-contain" />
            {s.busy && (
              <div role="status" className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-black/60 px-3 py-2 text-sm text-white"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Creating your new version… this can take a minute.</div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowOriginal((v) => !v)} aria-pressed={showOriginal}>{showOriginal ? 'Show current' : 'Compare with original'}</Button>
            {current && !current.saved && current.hasImage && <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(current.id)}><Bookmark className="h-4 w-4" aria-hidden="true" />Save design</Button>}
            {current?.saved && <span className="inline-flex items-center gap-1 text-sm text-green-700"><Check className="h-4 w-4" aria-hidden="true" />Saved</span>}
            {!s.previewIsOriginal && <Button size="sm" variant="ghost" disabled={s.busy} onClick={() => setConfirm({ kind: 'orig' })}><RotateCcw className="h-4 w-4" aria-hidden="true" />Back to original</Button>}
            <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'session' })}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete session</Button>
          </div>

          <TryOnPanel sessionId={id} versionId={current?.id} enabled />

          <section className="card p-4 sm:p-5" aria-labelledby="ver-hist">
            <h2 id="ver-hist" className="flex items-center gap-2 font-sans text-base font-semibold"><History className="h-4 w-4" aria-hidden="true" />Versions</h2>
            {versions.length === 0 ? <p className="mt-2 text-sm text-muted">No versions yet. Describe a change in the chat.</p> : (
              <ul className="mt-3 space-y-2">
                {versions.map((v) => (
                  <li key={v.id} className={`rounded-xl border p-3 text-sm ${v.isCurrent ? 'border-brand bg-brand/5' : 'border-line'}`}>
                    <div className="flex items-start gap-3">
                      {v.hasImage && <PrivateImage src={v.imageUrl} alt={`Version ${v.number}`} onExpired={refresh} className="h-16 w-14 shrink-0 rounded-lg bg-sand object-cover" />}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">Version {v.number}{v.isCurrent && <span className="ml-2 text-xs text-brand">current</span>}{v.saved && <span className="ml-2 text-xs text-green-700">saved</span>}</p>
                        <p className="break-words text-xs text-muted">{v.instruction}</p>
                        {v.status === 'processing' && <p className="text-xs text-muted">Generating…</p>}
                        {v.status === 'failed' && <p className="text-xs text-red-700">{v.error?.message || 'This version failed.'}</p>}
                      </div>
                    </div>
                    {v.status !== 'processing' && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {!v.isCurrent && v.status === 'completed' && <Button size="sm" variant="outline" disabled={s.busy} onClick={() => restore.mutate(v.id)}>Restore</Button>}
                        {v.status === 'completed' && !v.saved && v.hasImage && <Button size="sm" variant="ghost" onClick={() => save.mutate(v.id)}>Save</Button>}
                        <Button size="sm" variant="ghost" aria-label={`Delete version ${v.number}`} onClick={() => setConfirm({ kind: 'version', id: v.id, n: v.number })}><X className="h-4 w-4" aria-hidden="true" /></Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Chat */}
        <section className="card flex min-h-[420px] min-w-0 flex-col p-4 sm:p-5" aria-label="AI chat">
          <div className="flex-1 space-y-3 overflow-y-auto pr-1 lg:max-h-[70vh]" aria-live="polite">
            {s.messages.length === 0 && (
              <p className="rounded-xl bg-sand p-4 text-sm text-muted"><Sparkles className="mr-1 inline h-4 w-4 text-brand" aria-hidden="true" />Tell me what to change, for example “make it navy blue” or “add a small floral pattern”. I can only change what is visible in the image{s.product?.has3d ? ' and the options this product really offers' : ''}.</p>
            )}
            {s.messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm ${m.role === 'user' ? 'bg-brand text-white' : 'bg-sand text-ink'}`}>
                  {m.text}
                  {m.error && m.error.message !== m.text && <p className={`mt-1 text-xs ${m.role === 'user' ? 'text-white/90' : 'text-red-700'}`}>{m.error.message}</p>}
                </div>
              </div>
            ))}
            {s.busy && <p className="text-xs text-muted">Working on it…</p>}
            <div ref={endRef} />
          </div>
          <form className="mt-4 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (canSend) send.mutate(); }}>
            <label htmlFor="ai-msg" className="sr-only">Describe a change</label>
            <textarea id="ai-msg" rows={2} value={text} maxLength={s.limits.maxMessageChars} onChange={(e) => setText(e.target.value)} disabled={s.busy || s.status !== 'active'}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) send.mutate(); } }}
              placeholder={s.busy ? 'Please wait for the current version…' : 'Describe a change…'} className="min-h-[44px] flex-1 resize-none rounded-xl border border-line px-3 py-2 text-sm" />
            <Button type="submit" disabled={!canSend} aria-label="Send">{send.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}</Button>
          </form>
          <p className="mt-1 text-right text-xs text-muted">{text.length}/{s.limits.maxMessageChars}</p>
        </section>
      </div>

      <ConfirmDialog open={!!confirm} loading={removeSession.isPending || removeVer.isPending || restoreOrig.isPending}
        title={confirm?.kind === 'session' ? 'Delete this session?' : confirm?.kind === 'version' ? `Delete version ${confirm.n}?` : 'Go back to the original?'}
        message={confirm?.kind === 'session' ? 'The original, all versions and the chat are permanently deleted.' : confirm?.kind === 'version' ? 'This version image is permanently deleted.' : 'The next edit will start from the original image. Your versions stay in the history.'}
        confirmLabel={confirm?.kind === 'orig' ? 'Go back' : 'Delete'} onCancel={() => setConfirm(null)}
        onConfirm={() => (confirm.kind === 'session' ? removeSession.mutate() : confirm.kind === 'version' ? removeVer.mutate(confirm.id) : restoreOrig.mutate())} />
    </div>
  );
}