'use client';

import { useState, useEffect } from 'react';
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

type ToastEventDetail = Omit<ToastItem, 'id'> & { id?: string };

// Custom event to communicate between toast helper and container
const TOAST_EVENT = 'papyrus:toast';

export function toast(message: string, type: ToastType = 'info', duration = 4000, action?: ToastItem['action']) {
  if (typeof window === 'undefined') return;
  const event = new CustomEvent(TOAST_EVENT, {
    detail: { message, type, duration, action }
  });
  window.dispatchEvent(event);
}

toast.success = (message: string, duration = 4000, action?: ToastItem['action']) => toast(message, 'success', duration, action);
toast.error = (message: string, duration = 4000, action?: ToastItem['action']) => toast(message, 'error', duration, action);
toast.warning = (message: string, duration = 4000, action?: ToastItem['action']) => toast(message, 'warning', duration, action);
toast.info = (message: string, duration = 4000, action?: ToastItem['action']) => toast(message, 'info', duration, action);

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handleToastEvent = (e: Event) => {
      const customEvent = e as CustomEvent<ToastEventDetail>;
      const { message, type, duration, action } = customEvent.detail;
      const id = Math.random().toString(36).substring(2, 9);
      
      const newToast: ToastItem = {
        id,
        message,
        type,
        duration,
        action
      };

      setToasts((prev) => [...prev, newToast]);

      if (duration !== 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration || 4000);
      }
    };

    window.addEventListener(TOAST_EVENT, handleToastEvent);
    return () => {
      window.removeEventListener(TOAST_EVENT, handleToastEvent);
    };
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-9999 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => {
        let Icon = Info;
        let iconColor = 'text-mooove-cyan';
        const bgStyle = 'bg-bg-surface border-border';

        if (t.type === 'success') {
          Icon = CheckCircle;
          iconColor = 'text-green-600';
        } else if (t.type === 'error') {
          Icon = AlertCircle;
          iconColor = 'text-red-500';
        } else if (t.type === 'warning') {
          Icon = AlertTriangle;
          iconColor = 'text-mooove-amber';
        }

        return (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg transition-all duration-300 animate-slide-in',
              bgStyle
            )}
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border)'
            }}
          >
            <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', iconColor)} />
            
            <div className="flex-1 text-sm text-text-primary font-medium leading-relaxed wrap-break-word">
              {t.message}
              {t.action && (
                <button
                  onClick={() => {
                    t.action?.onClick();
                    removeToast(t.id);
                  }}
                  className="mt-1.5 block text-xs font-semibold text-mooove-navy hover:underline text-left transition"
                >
                  {t.action.label}
                </button>
              )}
            </div>

            <button
              onClick={() => removeToast(t.id)}
              className="text-text-tertiary hover:text-text-primary shrink-0 transition"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
