import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary: 'bg-ink text-white hover:bg-black',
  brand: 'bg-brand text-white hover:bg-brand-dark',
  outline: 'border border-line bg-white text-ink hover:bg-sand',
  ghost: 'text-ink hover:bg-sand',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};
const SIZES = { sm: 'h-9 px-3 text-sm', md: 'h-11 px-5 text-sm', lg: 'h-12 px-7 text-base' };

/**
 * Button. Pass `to` to render a router Link styled as a button.
 */
export default function Button({ variant = 'primary', size = 'md', loading = false, to, className = '', children, disabled, type = 'button', ...rest }) {
  const cls = `inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
  if (to) return <Link to={to} className={cls} {...rest}>{children}</Link>;
  return (
    <button type={type} className={cls} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
