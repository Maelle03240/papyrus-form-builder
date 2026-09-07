import type { Field, Form, Section } from '@/types';

/**
 * Découpage d'un formulaire en sections.
 *
 * Ces fonctions cherchaient auparavant des pseudo-champs `section_break` dans la
 * liste plate. Les sections sont maintenant des objets à part entière : le
 * découpage est lu, plus deviné.
 *
 * Les champs restent disponibles à plat sur `Form.fields`, dans l'ordre de
 * lecture, parce que la quasi-totalité du produit raisonne sur une liste
 * ordonnée — la logique conditionnelle, la validation, les colonnes d'export.
 */

/** Une section accompagnée de ses champs, garantis non nuls. */
export interface SectionPage extends Section {
  fields: Field[];
}

/**
 * Les sections d'un formulaire, dans l'ordre, chacune avec ses champs.
 *
 * Un formulaire possède toujours au moins une section depuis la migration 004.
 * Le repli sur une section unique synthétique ne couvre donc qu'un cas : un
 * formulaire construit en mémoire, jamais enregistré — un aperçu de modèle, par
 * exemple. Sans lui, l'aperçu n'afficherait rien du tout.
 */
export function buildPages(form: Pick<Form, 'sections' | 'fields'>): SectionPage[] {
  const sections = form.sections ?? [];
  const fields = form.fields ?? [];

  if (sections.length === 0) {
    return [
      {
        id: 'section-implicite',
        form_id: '',
        title: {} as Section['title'],
        description: {} as Section['description'],
        section_order: 0,
        fields
      }
    ];
  }

  // Le tri vient avant la répartition : le repli des champs orphelins vise la
  // première section **dans l'ordre d'affichage**, pas la première rencontrée
  // dans le tableau reçu — l'ordre de PostgREST n'est pas garanti.
  const ordered = [...sections].sort((a, b) => a.section_order - b.section_order);

  const bySection = new Map<string, Field[]>();
  for (const section of ordered) bySection.set(section.id, []);

  for (const field of fields) {
    const bucket = bySection.get(field.section_id);
    // Un champ dont la section a disparu ne doit pas s'évaporer du rendu : il
    // rejoint la première section, où son auteur le retrouvera pour le déplacer.
    if (bucket) bucket.push(field);
    else bySection.get(ordered[0].id)?.push(field);
  }

  return ordered
    .map((section) => ({
      ...section,
      fields: (bySection.get(section.id) ?? []).sort((a, b) => a.field_order - b.field_order)
    }));
}

/**
 * Les autres champs de la section qui contient `sourceFieldId`.
 *
 * Sert aux cibles de la logique conditionnelle en mode « pages » : afficher ou
 * masquer un champ d'une autre page n'aurait aucun effet visible, puisque
 * l'autre page n'est pas à l'écran.
 */
export function getFieldsInSameSection(
  form: Pick<Form, 'sections' | 'fields'>,
  sourceFieldId: string
): Field[] {
  const source = (form.fields ?? []).find((field) => field.id === sourceFieldId);
  if (!source) return [];

  return (form.fields ?? []).filter(
    (field) => field.section_id === source.section_id && field.id !== sourceFieldId
  );
}

/** Les sections du formulaire, dans l'ordre — cibles d'un « aller à ». */
export function getSections(form: Pick<Form, 'sections'>): Section[] {
  return [...(form.sections ?? [])].sort((a, b) => a.section_order - b.section_order);
}

/**
 * Remet les champs à plat dans l'ordre de lecture : sections dans l'ordre, puis
 * champs dans l'ordre à l'intérieur de chacune.
 *
 * C'est cet ordre que `Form.fields` doit toujours porter — la barre de
 * progression, la validation et les colonnes d'export en dépendent.
 */
export function flattenFields(sections: Section[]): Field[] {
  return [...sections]
    .sort((a, b) => a.section_order - b.section_order)
    .flatMap((section) =>
      [...(section.fields ?? [])].sort((a, b) => a.field_order - b.field_order)
    );
}
