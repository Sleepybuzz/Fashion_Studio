import { Shirt } from 'lucide-react';
import { imageSrc } from '../services/api.js';

/**
 * Product image with a neutral placeholder when no image is available.
 * Fixed aspect ratio avoids layout shift and distortion (object-cover).
 */
export default function ProductImage({ src, alt = '', ratio = 'aspect-[4/5]', className = '' }) {
  const url = imageSrc(src);
  return (
    <div className={`relative w-full overflow-hidden bg-sand ${ratio} ${className}`}>
      {url ? (
        <img src={url} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-sand to-[#E6E1DA]" role="img" aria-label={alt || 'No image available'}>
          <Shirt className="h-1/4 w-1/4 text-muted/50" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
