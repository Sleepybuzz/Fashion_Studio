import { useRef } from 'react';
import { imageSrc } from '../../services/api.js';

/**
 * <img> for a signed private image URL. Signed URLs expire; on a load error we ask the parent to refresh
 * the data once (which returns freshly signed URLs) instead of showing a broken image forever.
 */
export default function PrivateImage({ src, alt, onExpired, className = '', ...rest }) {
  const asked = useRef(false);
  return (
    <img
      src={imageSrc(src)}
      alt={alt}
      className={className}
      onError={() => { if (!asked.current) { asked.current = true; onExpired?.(); } }}
      {...rest}
    />
  );
}
