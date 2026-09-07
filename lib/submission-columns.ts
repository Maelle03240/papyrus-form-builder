import type { Field } from '@/types';

/**
 * Convertit un texte (ex : libellé d'option) en slug sûr pour un nom de colonne SQL.
 * Garde uniquement [a-z0-9_], coupe à 32 caractères.
 */
export function slugifyForColumn(input: string): string {
  return (input ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
    .replace(/_+$/g, '') || 'opt';
}

/**
 * Donne le nom de colonne pour la valeur principale d'un champ (hors sous-champs).
 * Format : `[field_id_short]` — on tronque l'ID pour rester lisible.
 */
export function fieldColumn(field: Field): string {
  return shortId(field.id);
}

/**
 * Donne le nom de colonne pour un sous-champ d'une option cochée d'un multiple_choice.
 * Format : `[field_id_short]__[option_slug]__[subfield_id_short]`.
 * Exemple : `q3__bereal__email`.
 */
export function subfieldColumn(
  field: Field,
  optionLabel: string,
  subfieldId: string
): string {
  return `${shortId(field.id)}__${slugifyForColumn(optionLabel)}__${shortId(subfieldId)}`;
}

/**
 * Liste tous les noms de colonnes nécessaires pour un champ donné. Utilisé à la publication
 * du formulaire pour générer les ALTER TABLE / migrations Supabase.
 */
export function fieldColumns(field: Field): string[] {
  // Champs sans réponse stockable (image / vidéo / section / texte libre)
  if (
    field.type === 'image' ||
    field.type === 'video' ||
    field.type === 'statement'
  ) {
    return [];
  }

  // multiple_choice avec sous-questions : une colonne par (option × sous-champ)
  if (
    field.type === 'multiple_choice' &&
    field.validation?.has_subfields &&
    (field.subfields?.length ?? 0) > 0
  ) {
    const cols: string[] = [shortId(field.id)]; // colonne principale = liste des options cochées (CSV ou JSONB)
    for (const opt of field.options ?? []) {
      for (const sf of field.subfields ?? []) {
        cols.push(subfieldColumn(field, opt.label.fr || opt.id, sf.id));
      }
    }
    return cols;
  }

  return [fieldColumn(field)];
}

function shortId(id: string): string {
  // UUID v4 → on garde les 8 premiers caractères, suffisants pour rester unique au sein d'un form
  return (id ?? '').replace(/-/g, '').slice(0, 8) || 'col';
}
