'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Slug du formulaire actuellement affiché côté répondant.
 *
 * Les champs d'upload en ont besoin pour obtenir une URL d'envoi signée : le
 * serveur vérifie que ce slug correspond à un formulaire publié avant de signer
 * quoi que ce soit. Le passer par contexte évite de faire descendre une prop à
 * travers toute la chaîne de rendu des champs, qui est partagée avec le builder.
 *
 * Vaut `null` dans le builder — aucun envoi de répondant n'y est possible.
 */
const FormSlugContext = createContext<string | null>(null);

export function FormSlugProvider({ slug, children }: { slug: string; children: ReactNode }) {
  return <FormSlugContext.Provider value={slug}>{children}</FormSlugContext.Provider>;
}

export function useFormSlug(): string | null {
  return useContext(FormSlugContext);
}
