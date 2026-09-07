import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'cta';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

const variantStyles: Record<Variant, string> = {
  primary: 'bg-mooove-navy text-mooove-ice hover:opacity-90',
  secondary: 'bg-bg-surface text-text-primary border border-border-strong hover:bg-bg-elevated',
  ghost: 'text-text-secondary hover:text-text-primary hover:bg-bg-surface',
  danger: 'bg-danger text-white hover:opacity-90',
  cta: 'bg-mooove-cyan text-mooove-navy hover:opacity-90 font-medium'
};

const sizeStyles: Record<Size, string> = {
  sm: 'h-7 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-base gap-2'
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = 'primary', size = 'md', loading, iconLeft, iconRight, children, disabled, ...props },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center rounded-md transition-all',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-cta focus-visible:ring-offset-2',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : iconLeft}
        {children}
        {!loading && iconRight}
      </button>
    );
  }
);
Button.displayName = 'Button';
