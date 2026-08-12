'use client';

import type { Form, FormScope } from '@/types';
import type { TemplateDefinition } from '@/lib/templates/types';
import { importForm } from './supabase-forms';

/**
 * Modèles côté client.
 *
 * Les modèles Mooove ne sont plus embarqués dans le bundle : ils vivent dans
 * `lib/templates/catalog/`, sont servis par `/api/templates` et ne sont chargés
 * en entier qu'au moment où on les ouvre ou les utilise.
 */

/**
 * Clone un modèle dans les formulaires de l'utilisateur.
 *
 * Délègue à `importForm`, qui est la seule fonction du projet à remapper
 * correctement les identifiants de champs, d'options et de lignes — et donc les
 * références que portent les règles de logique conditionnelle.
 *
 * L'implémentation précédente réécrivait ce travail à la main et perdait, sans
 * la moindre erreur, la logique conditionnelle, les points de scoring et les
 * réglages du formulaire. Sur un modèle global elle échouait franchement, en
 * écrivant un identifiant textuel dans une colonne `uuid`.
 */
export async function cloneTemplate(template: Form): Promise<Form> {
  return importForm({
    ...template,
    is_template: false,
    scope: undefined,
    status: 'draft',
    template_origin_id: null,
    settings: {
      ...(template.settings ?? {}),
      // Trace d'origine : chaîne libre, pas une clé étrangère.
      template_origin_slug: template.slug
    }
  });
}

/**
 * Trie les modèles locaux par périmètre.
 * Les modèles globaux ne passent plus par ici — ils viennent de `/api/templates`.
 */
export function listLocalTemplatesByScope(
  localForms: Form[]
): Record<Exclude<FormScope, 'global'>, Form[]> {
  const personal: Form[] = [];
  const workspace: Form[] = [];

  for (const form of localForms) {
    if (!form.is_template) continue;
    if (form.scope === 'workspace') workspace.push(form);
    else personal.push(form); // par défaut, un modèle local est personnel
  }

  return { personal, workspace };
}

/** Renvoie un modèle local par son identifiant. */
export function getLocalTemplate(id: string, localForms: Form[]): Form | null {
  return localForms.find((f) => f.id === id && f.is_template) ?? null;
}

/** Charge la définition complète d'un modèle Mooove. */
export async function fetchGlobalTemplateDefinition(slug: string): Promise<TemplateDefinition> {
  const response = await fetch(`/api/templates/${encodeURIComponent(slug)}`);
  if (!response.ok) throw new Error('Modèle introuvable');
  return (await response.json()) as TemplateDefinition;
}

/** Charge un modèle Mooove complet, converti en `Form` prêt à cloner. */
export async function fetchGlobalTemplate(slug: string, lang: 'fr' | 'en' = 'fr'): Promise<Form> {
  const def = await fetchGlobalTemplateDefinition(slug);
  const { templateToForm } = await import('@/lib/templates/to-form');
  return templateToForm(def, lang);
}
