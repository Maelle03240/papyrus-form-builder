'use client';

import { cn } from '@/lib/utils';
import type { EmbedMode } from '@/types';

/**
 * Carte de choix d'un mode d'intégration.
 *
 * L'aperçu est une maquette de navigateur dessinée en CSS plutôt qu'une image :
 * elle suit les tokens du thème (fond, bordures, accent), donc elle reste juste
 * en mode sombre comme en mode clair, sans qu'il faille maintenir deux fichiers.
 */

const LABELS: Record<EmbedMode, { title: string; hint: string }> = {
  standard: {
    title: 'Standard',
    hint: 'Le formulaire prend sa place dans le flux de la page.'
  },
  popup: {
    title: 'Popup',
    hint: 'Le formulaire s’ouvre par-dessus la page, sur clic ou automatiquement.'
  },
  fullpage: {
    title: 'Pleine page',
    hint: 'Le formulaire occupe toute la fenêtre du site hôte.'
  }
};

export function EmbedModeCard({
  mode,
  selected,
  onSelect
}: {
  mode: EmbedMode;
  selected: boolean;
  onSelect: () => void;
}) {
  const { title, hint } = LABELS[mode];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'group flex flex-col items-center gap-3 rounded-2xl border p-3 text-center transition',
        selected
          ? 'border-accent-cta bg-accent-cta/5 shadow-xs'
          : 'border-border bg-bg-surface hover:border-border-strong'
      )}
    >
      <BrowserMock mode={mode} />
      <div>
        <div className="text-sm font-bold text-text-primary">{title}</div>
        <div className="mt-0.5 text-[11px] leading-snug text-text-tertiary">{hint}</div>
      </div>
    </button>
  );
}

/** Petite fenêtre de navigateur schématique — le formulaire y est le bloc coloré. */
function BrowserMock({ mode }: { mode: EmbedMode }) {
  const form = 'rounded-[3px] bg-accent-cta/35';
  const line = 'rounded-full bg-text-tertiary/25';

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-bg-base">
      {/* Barre de titre */}
      <div className="flex items-center gap-1 border-b border-border bg-bg-elevated px-2 py-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary/40" />
        <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary/40" />
        <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary/40" />
      </div>

      <div className="relative h-[112px] p-3">
        {mode === 'fullpage' ? (
          <div className={cn(form, 'absolute inset-0 rounded-none')} />
        ) : (
          <div className="space-y-1.5">
            <div className={cn(line, 'h-1.5 w-1/2 bg-text-tertiary/40')} />
            <div className={cn(line, 'h-1 w-full')} />
            <div className={cn(line, 'h-1 w-4/5')} />

            {mode === 'standard' && (
              <>
                <div className={cn(form, 'mt-2 h-10 w-3/5')} />
                <div className={cn(line, 'mt-2 h-1 w-full')} />
                <div className={cn(line, 'h-1 w-2/3')} />
              </>
            )}

            {mode === 'popup' && (
              <>
                <div className={cn(line, 'h-1 w-3/5')} />
                <div className="mt-1 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary/30" />
                  <div className={cn(line, 'h-1 w-1/3')} />
                </div>
                <div className={cn(form, 'absolute bottom-2 right-2 h-9 w-[38%]')} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
