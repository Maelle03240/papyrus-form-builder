'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';

interface ClosingDateModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialClosesAt: string | null;
  onSave: (closesAt: string | null) => Promise<void>;
  formTitle: string;
}

export function ClosingDateModal({
  isOpen,
  onClose,
  initialClosesAt,
  onSave,
  formTitle
}: ClosingDateModalProps) {
  const [hasClosingDate, setHasClosingDate] = useState(false);
  const [dateValue, setDateValue] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setHasClosingDate(!!initialClosesAt);
      if (initialClosesAt) {
        setDateValue(initialClosesAt.slice(0, 16));
      } else {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        // Format to YYYY-MM-DDTHH:MM local time
        const localIsoString = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
        setDateValue(localIsoString);
      }
    }
  }, [isOpen, initialClosesAt]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const finalValue = hasClosingDate ? dateValue : null;
      await onSave(finalValue);
      onClose();
    } catch (err) {
      console.error('Failed to save closing date:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || typeof window === 'undefined') return null;

  return createPortal(
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Date de clôture"
      size="sm"
    >
      <div className="space-y-5 font-body">
        <div>
          <p className="text-xs text-text-tertiary mb-2">
            Configurez la date de fin pour le formulaire <strong className="text-text-primary">« {formTitle} »</strong>.
          </p>
        </div>

        <div className="bg-bg-elevated/40 rounded-xl p-4 border border-border space-y-4">
          <Switch
            checked={hasClosingDate}
            onChange={(checked) => setHasClosingDate(checked)}
            label="Définir une date de clôture"
            description="Le formulaire n'acceptera plus de réponses après cette date."
          />

          {hasClosingDate && (
            <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
              <label className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-text-tertiary" />
                Date et heure limite
              </label>
              <input
                type="datetime-local"
                value={dateValue}
                onChange={(e) => setDateValue(e.target.value)}
                className="h-10 w-full rounded-md border border-border-strong bg-bg-surface px-3 text-sm text-text-primary focus:border-accent focus:outline-hidden"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={loading}
          >
            Annuler
          </Button>
          <Button
            variant="cta"
            size="sm"
            loading={loading}
            onClick={handleSave}
          >
            Enregistrer
          </Button>
        </div>
      </div>
    </Modal>,
    document.body
  );
}
