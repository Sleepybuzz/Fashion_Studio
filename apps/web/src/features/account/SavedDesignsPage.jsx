import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Check, Pencil, Trash2, X } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import ProductImage from '../../components/ImagePlaceholder.jsx';
import { EmptyState, ErrorMessage, Notice, Spinner } from '../../components/ui/Feedback.jsx';
import { garmentService } from '../../services/garment.service.js';
import { parseError } from '../../services/api.js';

/** Customer area: saved 3D designs (/account/designs). */
export default function SavedDesignsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['designs'], queryFn: garmentService.designs });
  const [toDelete, setToDelete] = useState(null);
  const [renaming, setRenaming] = useState(null); // { id, name }
  const [error, setError] = useState('');

  const refresh = () => qc.invalidateQueries({ queryKey: ['designs'] });
  const del = useMutation({
    mutationFn: (id) => garmentService.deleteDesign(id),
    onSuccess: (_r, id) => { setToDelete(null); qc.removeQueries({ queryKey: ['design', String(id)] }); refresh(); },
    onError: (e) => { setError(parseError(e).message); setToDelete(null); },
  });
  const rename = useMutation({
    mutationFn: ({ id, name }) => garmentService.updateDesign(id, { name }),
    onSuccess: () => { setRenaming(null); setError(''); refresh(); },
    onError: (e) => setError(parseError(e).message),
  });

  if (isLoading) return <Spinner />;
  if (isError) return <ErrorMessage message="Could not load your saved designs." onRetry={refetch} />;

  return (
    <div>
      <h2 className="font-sans text-xl font-semibold">3D designs</h2>
      <p className="mt-1 text-sm text-muted">Your saved garment customizations{data.maxDesigns ? ` (up to ${data.maxDesigns})` : ''}.</p>
      {error && <div className="mt-4"><Notice type="error">{error}</Notice></div>}

      {!data.items.length ? (
        <div className="mt-6">
          <EmptyState icon={Box} title="No saved designs yet" text="Open a product with a 3D model, customize it, and choose Save design." action={<Button to="/shop" size="sm">Browse products</Button>} />
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {data.items.map((d) => (
            <li key={d.id} className="card flex gap-4 p-4">
              <div className="w-20 shrink-0 sm:w-24"><ProductImage src={d.product.primaryImage} alt="" ratio="aspect-[4/5]" className="rounded-xl" /></div>
              <div className="min-w-0 flex-1">
                {renaming?.id === d.id ? (
                  <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (renaming.name.trim()) rename.mutate({ id: d.id, name: renaming.name.trim() }); }}>
                    <input aria-label="Design name" autoFocus maxLength={80} value={renaming.name} onChange={(e) => setRenaming({ id: d.id, name: e.target.value })}
                      className="h-10 min-w-0 flex-1 rounded-lg border border-line px-3 text-sm focus:border-brand focus:outline-none" />
                    <button type="submit" aria-label="Save name" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-sand"><Check className="h-4 w-4" /></button>
                    <button type="button" aria-label="Cancel rename" onClick={() => setRenaming(null)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-sand"><X className="h-4 w-4" /></button>
                  </form>
                ) : (
                  <h3 className="truncate font-sans text-base font-semibold">{d.name}</h3>
                )}
                <p className="truncate text-sm text-muted">{d.product.name}</p>
                <p className="mt-1 text-xs text-muted">
                  {[d.summary.color && `Colour: ${d.summary.color}`, d.summary.material && `Material: ${d.summary.material}`].filter(Boolean).join(' · ') || 'Original colours and material'}
                </p>
                <p className="text-xs text-muted">Updated {new Date(d.updatedAt).toLocaleDateString()}</p>
                {!d.available && <p className="mt-1 text-xs text-amber-700">This product or its 3D model is no longer available.</p>}
                {d.available && d.outdated && <p className="mt-1 text-xs text-amber-700">Some choices are no longer offered; they will be reset when opened.</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {d.available && <Button to={`/studio/${d.product.slug}?design=${d.id}`} size="sm">Open in studio</Button>}
                  <button onClick={() => setRenaming({ id: d.id, name: d.name })} aria-label={`Rename ${d.name}`} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-sand"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => setToDelete(d)} aria-label={`Delete ${d.name}`} className="flex h-9 w-9 items-center justify-center rounded-full text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-xs text-muted">Looking for something else? <Link to="/shop" className="underline">Browse the shop</Link>.</p>

      <ConfirmDialog open={!!toDelete} title="Delete this design?" message={`“${toDelete?.name ?? ''}” will be permanently removed.`}
        loading={del.isPending} onConfirm={() => del.mutate(toDelete.id)} onCancel={() => setToDelete(null)} />
    </div>
  );
}
