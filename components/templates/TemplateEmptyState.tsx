'use client';

import { LayoutTemplate, Search, X } from 'lucide-react';

/**
 * États vides de la galerie de modèles.
 * Extrait de l'ancien `templates/page.tsx`, qui devient un Server Component et
 * ne peut donc plus héberger de composant à état.
 */

export type TemplateTab = 'global' | 'workspace' | 'personal';

const MESSAGES: Record<TemplateTab, { title: string; hint: string }> = {
  personal: {
    title: 'Aucun modèle personnel',
    hint: 'Depuis un formulaire existant, marquez-le comme modèle pour le réutiliser plus tard.'
  },
  workspace: {
    title: "Aucun modèle d'équipe",
    hint: 'Les administrateurs peuvent élever un modèle perso au périmètre équipe (bientôt).'
  },
  global: {
    title: 'Aucun modèle ne correspond',
    hint: 'Élargissez les filtres ou changez de catégorie.'
  }
};

export function TemplateEmptyState({
  tab,
  search,
  onClearSearch
}: {
  tab: TemplateTab;
  search: string;
  onClearSearch: () => void;
}) {
  if (search.trim()) {
    return (
      <div className="rounded-2xl border border-dashed border-border-strong bg-bg-surface p-12 text-center">
        <Search className="mx-auto h-8 w-8 text-text-tertiary" />
        <h3 className="mt-3 font-display text-lg">Aucun résultat</h3>
        <p className="papyrus-meta mt-1 text-sm">
          i. Aucun modèle ne correspond à votre recherche dans cet onglet.
        </p>
        <button
          type="button"
          onClick={onClearSearch}
          className="mt-3 inline-flex items-center gap-1 text-sm text-accent hover:underline"
        >
          <X className="h-3.5 w-3.5" /> Effacer la recherche
        </button>
      </div>
    );
  }

  const message = MESSAGES[tab];

  return (
    <div className="rounded-2xl border border-dashed border-border-strong bg-bg-surface p-12 text-center">
      <LayoutTemplate className="mx-auto h-10 w-10 text-text-tertiary" />
      <h3 className="mt-4 font-display text-xl">{message.title}</h3>
      <p className="papyrus-meta mt-1 text-sm">i. {message.hint}</p>
    </div>
  );
}
