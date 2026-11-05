import ProductCard from './ProductCard.jsx';

/** Responsive product grid: 2 cols on phones, up to 4 on desktop. */
export default function ProductGrid({ products }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => <ProductCard key={p.id} product={p} />)}
    </div>
  );
}
