import { Link } from 'react-router-dom';
import { Mail, MapPin, Phone } from 'lucide-react';
import { useCategories, useStoreInfo } from '../hooks/useStore.js';

export default function Footer() {
  const { data: info } = useStoreInfo();
  const { data: categories = [] } = useCategories();
  return (
    <footer className="mt-24 border-t border-line bg-sand">
      <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <p className="font-display text-xl font-semibold">{info?.storeName || 'AI Fashion Studio'}</p>
          <p className="mt-3 max-w-xs text-sm text-muted">Thoughtfully made clothing from an independent label.</p>
        </div>
        <div>
          <h2 className="font-sans text-sm font-semibold">Shop</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li><Link to="/shop" className="hover:text-ink">All products</Link></li>
            {categories.slice(0, 5).map((c) => (
              <li key={c.id}><Link to={`/shop?category=${c.slug}`} className="hover:text-ink">{c.name}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-sans text-sm font-semibold">Company</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li><Link to="/about" className="hover:text-ink">About</Link></li>
            <li><Link to="/contact" className="hover:text-ink">Contact</Link></li>
            <li><Link to="/login" className="hover:text-ink">Log in</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="font-sans text-sm font-semibold">Contact</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            {info?.contactEmail && <li className="flex gap-2"><Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><a href={`mailto:${info.contactEmail}`} className="break-all hover:text-ink">{info.contactEmail}</a></li>}
            {info?.contactPhone && <li className="flex gap-2"><Phone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{info.contactPhone}</li>}
            {info?.contactAddress && <li className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{info.contactAddress}</li>}
            {!info?.contactEmail && !info?.contactPhone && !info?.contactAddress && <li>Contact details will appear here once the store owner adds them in Settings.</li>}
          </ul>
        </div>
      </div>
      <div className="border-t border-line py-5 text-center text-xs text-muted">
        © {new Date().getFullYear()} {info?.storeName || 'AI Fashion Studio'}. All rights reserved.
      </div>
    </footer>
  );
}
