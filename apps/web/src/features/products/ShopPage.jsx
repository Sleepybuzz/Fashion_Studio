import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import ProductGrid from '../../components/ProductGrid.jsx';
import { EmptyState, ErrorMessage, Spinner } from '../../components/ui/Feedback.jsx';
import { catalogService } from '../../services/store.service.js';
import { useCategories } from '../../hooks/useStore.js';

const SORTS = [
  ['newest', 'Newest'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['name', 'Name A–Z'],
];

export default function ShopPage() {
  const [params, setParams] = useSearchParams();
  const category = params.get('category') || '';
  const sort = params.get('sort') || 'newest';
  const q = params.get('q') || '';
  const featured = params.get('featured') || '';
  const page = Number(params.get('page')) || 1;
  const [search, setSearch] = useState(q);
  const { data: categories = [] } = useCategories();

  useEffect(() => {
    setSearch(q);
  }, [q]);

  const update = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  const query = { category: category || undefined, sort, q: q || undefined, featured: featured || undefined, page, limit: 12 };
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['products', query],
    queryFn: () => catalogService.products(query),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="container-page py-8 sm:py-12">
      <h1 className="h-section">Shop</h1>

      <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <form onSubmit={(e) => { e.preventDefault(); update({ q: search.trim() }); }} role="search" className="relative w-full md:max-w-sm">
          <label htmlFor="shop-search" className="sr-only">Search products</label>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input id="shop-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products"
            className="h-11 w-full rounded-full border border-line bg-white pl-11 pr-4 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
        </form>
        <div className="flex items-center gap-2">
          <label htmlFor="sort" className="text-sm text-muted">Sort</label>
          <select id="sort" value={sort} onChange={(e) => update({ sort: e.target.value === 'newest' ? '' : e.target.value })}
            className="h-11 rounded-full border border-line bg-white px-4 text-sm">
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label="Filter by category">
        {[{ id: 'all', name: 'All', slug: '' }, ...categories].map((c) => (
          <button key={c.id} onClick={() => update({ category: c.slug })} aria-pressed={category === c.slug}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm ${category === c.slug ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:bg-sand'}`}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="mt-8" aria-busy={isFetching}>
        {isLoading && <Spinner />}
        {isError && <ErrorMessage message="We could not load products." onRetry={refetch} />}
        {data && !data.items.length && (
          <EmptyState title="No products found" text="Try a different search or category."
            action={(q || category || featured) && <button onClick={() => setParams({})} className="text-sm font-medium text-brand hover:underline">Clear filters</button>} />
        )}
        {data?.items.length > 0 && (
          <>
            <p className="mb-4 text-sm text-muted">{data.pagination.total} {data.pagination.total === 1 ? 'product' : 'products'}</p>
            <ProductGrid products={data.items} />
            {data.pagination.totalPages > 1 && (
              <nav className="mt-10 flex items-center justify-center gap-3" aria-label="Pagination">
                <button disabled={page <= 1} onClick={() => update({ page: String(page - 1) })} className="h-10 rounded-full border border-line bg-white px-5 text-sm disabled:opacity-40">Previous</button>
                <span className="text-sm text-muted">Page {page} of {data.pagination.totalPages}</span>
                <button disabled={page >= data.pagination.totalPages} onClick={() => update({ page: String(page + 1) })} className="h-10 rounded-full border border-line bg-white px-5 text-sm disabled:opacity-40">Next</button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}