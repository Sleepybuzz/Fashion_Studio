import { Link } from 'react-router-dom';
import ProductImage from './ImagePlaceholder.jsx';
import WishlistButton from './WishlistButton.jsx';
import { formatPrice } from '../utils/format.js';
import { useStoreInfo } from '../hooks/useStore.js';

export default function ProductCard({ product }) {
  const { data: info } = useStoreInfo();
  const currency = info?.currency || 'INR';
  const onSale = product.compareAtPrice && product.compareAtPrice > product.price;
  return (
    <article className="group relative">
      <Link to={`/shop/${product.slug}`} className="block">
        <div className="overflow-hidden rounded-2xl">
          <ProductImage src={product.primaryImage} alt={product.name} className="transition-transform duration-500 group-hover:scale-105" />
        </div>
        <div className="mt-3 space-y-0.5">
          {product.categoryName && <p className="text-xs uppercase tracking-wide text-muted">{product.categoryName}</p>}
          <h3 className="font-sans text-sm font-medium leading-snug">{product.name}</h3>
          <p className="text-sm">
            <span className="font-medium">{formatPrice(product.price, currency)}</span>
            {onSale && <span className="ml-2 text-muted line-through">{formatPrice(product.compareAtPrice, currency)}</span>}
          </p>
        </div>
      </Link>
      <WishlistButton productId={product.id} className="absolute right-2 top-2" />
    </article>
  );
}
