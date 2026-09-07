'use client';

import Link from 'next/link';
import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

/**
 * Les deux barres d'onglets des espaces de travail.
 *
 * Elles sont des liens, pas des boutons : l'onglet vit dans l'URL, donc il se
 * partage, se met en signet, et le bouton « Précédent » du navigateur fait ce
 * qu'on attend de lui. Une barre d'onglets pilotée par un état local perd les
 * trois.
 *
 * Les deux niveaux ne se ressemblent pas volontairement — souligné pour le
 * niveau principal, pastilles pour le niveau imbriqué. Deux barres au même
 * traitement, empilées, se lisent comme une seule barre de dix onglets.
 */

export interface TabItem {
  key: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /** Compteur affiché à droite du libellé (réponses, formulaires…). */
  count?: number;
  /** Onglet visible mais inerte, avec l'explication en infobulle. */
  disabled?: boolean;
  disabledReason?: string;
}

interface TabsProps {
  items: TabItem[];
  active: string;
}

export function WorkspaceTabs({ items, active }: TabsProps) {
  return (
    <div className="border-b border-border">
      <nav className="flex items-center gap-1 overflow-x-auto px-6" aria-label="Sections">
        {items.map((item) => {
          const isActive = item.key === active;
          const content = (
            <>
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
              {typeof item.count === 'number' && (
                <span className="tabular-nums text-xs text-text-tertiary">{item.count}</span>
              )}
            </>
          );

          const base =
            'flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition';

          if (item.disabled) {
            return (
              <span
                key={item.key}
                title={item.disabledReason}
                aria-disabled="true"
                className={cn(base, 'cursor-not-allowed border-transparent text-text-tertiary/50')}
              >
                {content}
              </span>
            );
          }

          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                base,
                'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-cta',
                isActive
                  ? 'border-accent text-text-primary'
                  : 'border-transparent text-text-tertiary hover:text-text-secondary'
              )}
            >
              {content}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function SubTabs({ items, active }: TabsProps) {
  return (
    <nav
      className="flex items-center gap-1 overflow-x-auto border-b border-border bg-bg-elevated px-6 py-2"
      aria-label="Configuration"
    >
      {items.map((item) => {
        const isActive = item.key === active;
        const content = (
          <>
            <item.icon className="h-3.5 w-3.5 shrink-0" />
            {item.label}
          </>
        );

        const base =
          'flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition';

        if (item.disabled) {
          return (
            <span
              key={item.key}
              title={item.disabledReason}
              aria-disabled="true"
              className={cn(base, 'cursor-not-allowed text-text-tertiary/50')}
            >
              {content}
            </span>
          );
        }

        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              base,
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-cta',
              isActive
                ? 'bg-bg-surface font-medium text-text-primary shadow-xs'
                : 'text-text-secondary hover:bg-bg-surface/60 hover:text-text-primary'
            )}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
