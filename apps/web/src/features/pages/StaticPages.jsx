import { Mail, MapPin, Phone } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import { useStoreInfo } from '../../hooks/useStore.js';

export function AboutPage() {
  const { data: info } = useStoreInfo();
  const name = info?.storeName || 'AI Fashion Studio';
  return (
    <div className="container-page max-w-3xl py-10 sm:py-16">
      <h1 className="h-hero">About {name}</h1>
      <div className="mt-6 space-y-4 text-base leading-relaxed text-muted">
        <p>{name} is an independent clothing label. We design our own pieces and sell them directly to customers through this store.</p>
        <p>We are building a more modern way to shop for clothing, including tools to explore garments in new ways. Those features will be added step by step and announced here once they are ready.</p>
        <p>The store owner can update this page and the store contact details at any time.</p>
      </div>
      <Button to="/shop" className="mt-8">Browse the collection</Button>
    </div>
  );
}

export function ContactPage() {
  const { data: info } = useStoreInfo();
  const rows = [
    [Mail, info?.contactEmail, info?.contactEmail && `mailto:${info.contactEmail}`],
    [Phone, info?.contactPhone, info?.contactPhone && `tel:${info.contactPhone.replace(/\s/g, '')}`],
    [MapPin, info?.contactAddress],
  ].filter(([, v]) => v);
  return (
    <div className="container-page max-w-3xl py-10 sm:py-16">
      <h1 className="h-hero">Contact</h1>
      <p className="mt-4 text-muted">Questions about a product or your account? Get in touch using the details below.</p>
      {rows.length ? (
        <ul className="card mt-8 divide-y divide-line">
          {rows.map(([Icon, value, href], i) => (
            <li key={i} className="flex items-center gap-4 p-5">
              <Icon className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
              {href ? <a href={href} className="break-all hover:underline">{value}</a> : <span>{value}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="card mt-8 p-6 text-sm text-muted">Contact details have not been added yet. The store owner can add them under Admin &rarr; Settings.</p>
      )}
    </div>
  );
}
