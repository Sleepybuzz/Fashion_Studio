import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Minus, Plus, ShoppingBag } from 'lucide-react';
import ProductImage from '../../components/ImagePlaceholder.jsx';
import WishlistButton from '../../components/WishlistButton.jsx';
import { ErrorMessage, Spinner } from '../../components/ui/Feedback.jsx';
import { catalogService } from '../../services/store.service.js';
import { useStoreInfo } from '../../hooks/useStore.js';
import { formatPrice } from '../../utils/format.js';

export default function ProductDetailPage() {
  const { slug } = useParams();
  const { data: info } = useStoreInfo();
  const { data: product, isLoading, error, refetch } = useQuery({
    queryKey: ['product', slug],
    queryFn: () => catalogService.product(slug),
  });
  const [active, setActive] = useState(0);
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [qty, setQty] = useState(1);

  const sizes = useMemo(() => [...new Set((product?.variants || []).map((v) => v.size).filter(Boolean))], [product]);
  const colors = useMemo(() => {
    const m = new Map();
    (product?.variants || []).forEach((v) => v.colorName && m.set(v.colorName, v.colorHex));
    return [...m.entries()];
  }, [product]);

  if (isLoading) return <Spinner />;
  if (error?.response?.status === 404) {
    return (
      <div className="container-page py-20 text-center">
        <h1 className="h-section">Product not found</h1>
        <p className="mt-2 text-muted">It may have been removed or is no longer available.</p>
        <Link to="/shop" className="mt-6 inline-block font-medium text-brand hover:underline">Back to shop</Link>
      </div>
    );
  }
  if (error) return <div className="container-page py-12"><ErrorMessage message="We could not load this product." onRetry={refetch} /></div>;

  const currency = info?.currency || 'INR';
  const images = product.images;
  const onSale = product.compareAtPrice && product.compareAtPrice > product.price;
  const totalStock = product.variants.reduce((n, v) => n + v.stockQuantity, 0);
  const inStock = product.variants.length === 0 || totalStock > 0;

  return (
    <div className="container-page py-8 sm:py-12">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
        <Link to="/shop" className="hover:text-ink">Shop</Link>
        {product.categoryName && <> / <Link to={`/shop?category=${product.categorySlug}`} className="hover:text-ink">{product.categoryName}</Link></>}
      </nav>

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-14">
        <div>
          <ProductImage src={images[active]?.url} alt={images[active]?.altText || product.name} className="rounded-2xl" ratio="aspect-[4/5]" />
          {images.length > 1 && (
            <div className="mt-3 grid grid-cols-5 gap-2">
              {images.map((img, i) => (
                <button key={img.id} onClick={() => setActive(i)} aria-label={`Show image ${i + 1}`} aria-current={i === active}
                  className={`overflow-hidden rounded-xl border-2 ${i === active ? 'border-brand' : 'border-transparent'}`}>
                  <ProductImage src={img.url} alt="" ratio="aspect-square" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-start justify-between gap-4">
            <h1 className="h-section">{product.name}</h1>
            <WishlistButton productId={product.id} className="shrink-0 border border-line" />
          </div>
          <p className="mt-3 text-xl">
            {formatPrice(product.price, currency)}
            {onSale && <span className="ml-3 text-base text-muted line-through">{formatPrice(product.compareAtPrice, currency)}</span>}
          </p>
          {product.description && <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-muted">{product.description}</p>}

          {colors.length > 0 && (
            <fieldset className="mt-6">
              <legend className="mb-2 text-sm font-medium">Colour{color && <span className="ml-2 font-normal text-muted">{color}</span>}</legend>
              <div className="flex flex-wrap gap-2">
                {colors.map(([name, hex]) => (
                  <button key={name} onClick={() => setColor(name)} aria-label={name} aria-pressed={color === name} title={name}
                    className={`h-9 w-9 rounded-full border-2 ${color === name ? 'border-brand' : 'border-line'}`} style={{ backgroundColor: hex || '#ccc' }} />
                ))}
              </div>
            </fieldset>
          )}

          {sizes.length > 0 && (
            <fieldset className="mt-6">
              <legend className="mb-2 text-sm font-medium">Size</legend>
              <div className="flex flex-wrap gap-2">
                {sizes.map((s) => (
                  <button key={s} onClick={() => setSize(s)} aria-pressed={size === s}
                    className={`h-11 min-w-[3rem] rounded-full border px-4 text-sm ${size === s ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:bg-sand'}`}>{s}</button>
                ))}
              </div>
            </fieldset>
          )}

          <div className="mt-6 flex items-center gap-3">
            <span className="text-sm font-medium">Quantity</span>
            <div className="flex items-center rounded-full border border-line bg-white">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity" className="flex h-11 w-11 items-center justify-center"><Minus className="h-4 w-4" /></button>
              <span className="w-8 text-center text-sm" aria-live="polite">{qty}</span>
              <button onClick={() => setQty((q) => Math.min(10, q + 1))} aria-label="Increase quantity" className="flex h-11 w-11 items-center justify-center"><Plus className="h-4 w-4" /></button>
            </div>
          </div>

          <p className={`mt-4 text-sm ${inStock ? 'text-leaf' : 'text-red-600'}`}>{inStock ? 'In stock' : 'Currently out of stock'}</p>

          <div className="mt-6 space-y-3">
            <button disabled aria-disabled="true" className="flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full bg-ink text-white opacity-40">
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />Add to cart
            </button>
            <p className="text-center text-xs text-muted">Cart and checkout are coming in a later release. Ordering is not available yet.</p>
            {product.has3dModel ? (
              <Link to={`/studio/${product.slug}`} className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-brand bg-white font-medium text-brand hover:bg-brand hover:text-white">
                <Box className="h-4 w-4" aria-hidden="true" />Customize in 3D
              </Link>
            ) : (
              <>
                <button disabled aria-disabled="true" className="flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full border border-line bg-white opacity-60">
                  <Box className="h-4 w-4" aria-hidden="true" />Customize in 3D
                </button>
                <p className="text-center text-xs text-muted">No 3D model is available for this product yet.</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
