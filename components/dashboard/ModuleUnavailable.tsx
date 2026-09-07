import type { ComponentType } from 'react';

interface ModuleUnavailableProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  /** Ce que le module fera — au présent, pas au futur promotionnel. */
  description: string;
}

/**
 * État d'un onglet dont le module n'est pas encore construit.
 *
 * Il dit ce que l'onglet fera, et rien d'autre : pas de bouton inerte, pas de
 * fausse configuration. Un écran qui prétend se paramétrer alors qu'il n'écrit
 * nulle part coûte plus cher en confiance qu'un onglet honnêtement vide.
 */
export function ModuleUnavailable({ icon: Icon, title, description }: ModuleUnavailableProps) {
  return (
    <div className="flex flex-col items-center px-6 py-20 text-center">
      <Icon className="h-6 w-6 text-text-tertiary" />
      <h2 className="mt-4 font-display text-lg font-bold text-text-primary">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-text-secondary">{description}</p>
      <p className="mt-6 text-xs text-text-tertiary">Cette section n&apos;est pas encore disponible.</p>
    </div>
  );
}
