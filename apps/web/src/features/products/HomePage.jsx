import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import ProductGrid from '../../components/ProductGrid.jsx';
import { ErrorMessage, Spinner, EmptyState } from '../../components/ui/Feedback.jsx';
import { catalogService } from '../../services/store.service.js';
import { useCategories, useStoreInfo } from '../../hooks/useStore.js';

function Section({ title, to, children }) {
  return (
    <section className="container-page mt-16 sm:mt-24">
      <div className="mb-6 flex items-end justify-between gap-4">
        <h2 className="h-section">{title}</h2>
        {to && <Link to={to} className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand hover:underline">View all <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
      </div>
      {children}
    </section>
  );
}

function ProductRow({ params, emptyTitle }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['products', params],
    queryFn: () => catalogService.products(params),
  });
  if (isLoading) return <Spinner />;
  if (isError) return <ErrorMessage message="We could not load products." onRetry={refetch} />;
  if (!data.items.length) return <EmptyState title={emptyTitle} text="Check back soon." />;
  return <ProductGrid products={data.items} />;
}

export default function HomePage() {
  const { data: categories = [] } = useCategories();
  const { data: info } = useStoreInfo();
  const name = info?.storeName || 'AI Fashion Studio';

  return (
    <>
      <section className="bg-sand">
        <div className="container-page grid items-center gap-8 py-14 sm:py-20 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand">New season</p>
            <h1 className="h-hero mt-4">Clothing made to be lived in.</h1>
            <p className="mt-5 max-w-md text-base text-muted">Considered essentials from {name}. Browse the collection and find pieces you will reach for every day.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button to="/shop" size="lg">Shop the collection</Button>
              <Button to="/about" variant="outline" size="lg">Our story</Button>
            </div>
          </div>
          <div className="aspect-[4/3] w-full rounded-3xl bg-gradient-to-br from-[#E9DFF3] via-[#F1EFEC] to-[#D8E9F5] lg:aspect-[5/4]" role="img" aria-label="Decorative colour wash" />
        </div>
      </section>

      {categories.length > 0 && (
        <Section title="Shop by category">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
            {categories.map((c) => (
              <Link key={c.id} to={`/shop?category=${c.slug}`}
                className="group flex aspect-[4/3] flex-col justify-end rounded-2xl border border-line bg-white p-4 transition hover:border-brand">
                <span className="font-display text-lg">{c.name}</span>
                <span className="text-xs text-muted">{c.productCount ?? 0} {c.productCount === 1 ? 'item' : 'items'}</span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <Section title="Featured" to="/shop?featured=true">
        <ProductRow params={{ featured: 'true', limit: 4 }} emptyTitle="No featured products yet" />
      </Section>

      <section className="container-page mt-16 sm:mt-24">
        <div className="rounded-3xl bg-ink px-6 py-12 text-center text-white sm:px-12 sm:py-16">
          <h2 className="h-section">Create an account</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-white/70">Save pieces to your wishlist and keep your details in one place.</p>
          <Button to="/register" variant="outline" className="mt-6">Get started</Button>
        </div>
      </section>

      <Section title="New arrivals" to="/shop?sort=newest">
        <ProductRow params={{ sort: 'newest', limit: 8 }} emptyTitle="No products yet" />
      </Section>

      <section className="container-page mt-16 sm:mt-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="h-section">About the store</h2>
          <p className="mt-4 text-muted">{name} is an independent clothing label. We design and sell our own pieces directly to you, with no middlemen.</p>
          <Link to="/about" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">Learn more <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </div>
      </section>
    </>
  );
}
