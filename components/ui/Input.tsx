import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
  hint?: string;
  showCounter?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, label, hint, id, showCounter = true, maxLength, type, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const inputId = id || props.name;
    const currentLength = typeof props.value === 'string' || typeof props.value === 'number' 
      ? String(props.value).length 
      : 0;

    const showCharCounter = showCounter && maxLength !== undefined && maxLength > 0;
    const isPasswordType = type === 'password';

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-sm text-text-secondary">
            {label}
          </label>
        )}
        <div className="relative">
          <input
            id={inputId}
            ref={ref}
            maxLength={maxLength}
            type={isPasswordType && showPassword ? 'text' : type}
            className={cn(
              'h-9 w-full rounded-md border bg-bg-surface px-3 text-sm text-text-primary',
              isPasswordType && 'pr-10',
              'placeholder:text-text-tertiary',
              'transition focus:border-accent focus:outline-hidden focus:ring-2 focus:ring-accent-cta/20',
              error ? 'border-danger' : 'border-border-strong',
              className
            )}
            {...props}
          />
          {isPasswordType && (
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition"
              aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          )}
        </div>
        {(hint || error || showCharCounter) && (
          <div className="flex items-start justify-between gap-2 text-xs">
            <div className="flex-1">
              {error ? (
                <p className="text-danger font-medium">{error}</p>
              ) : (
                hint && <p className="text-text-tertiary">{hint}</p>
              )}
            </div>
            {showCharCounter && (
              <span
                className={cn(
                  'shrink-0 text-text-tertiary font-mono select-none text-xs',
                  currentLength > maxLength * 0.8 && 'text-red-500 font-semibold'
                )}
              >
                {currentLength} / {maxLength}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';


