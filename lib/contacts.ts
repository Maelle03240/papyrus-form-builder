import { pickText } from '@/lib/email/tokens';
import type { Field, Form } from '@/types';

/**
 * Reconnaître une personne dans une réponse de formulaire.
 *
 * Papyrus ne demande jamais « quel champ est le nom ? » : ses formulaires sont
 * écrits librement, et exiger un mappage avant de pouvoir constituer un carnet
 * d'adresses reviendrait à ne jamais en constituer. On devine donc, à partir de
 * ce que le formulaire dit déjà de lui-même — le TYPE des champs d'abord, leur
 * INTITULÉ ensuite.
 *
 * L'ordre compte. Un champ de type `email` est un e-mail avec certitude ; un
 * champ dont l'intitulé contient « mail » ne l'est que probablement. Deviner sur
 * le type quand il est disponible, et sur les mots seulement à défaut, c'est ce
 * qui évite qu'une question « Adresse e-mail de votre responsable » devienne
 * l'adresse du contact.
 */

export interface ExtractedContact {
  name: string;
  email: string;
  phone: string;
  company: string;
}

/**
 * Les intitulés reconnus, par rôle.
 *
 * En français ET en anglais : un formulaire bilingue stocke les deux, et le
 * catalogue de modèles de Papyrus est écrit dans les deux langues.
 */
const PATTERNS = {
  firstName: /(pr[ée]nom|first\s*name|given\s*name)/i,
  lastName: /(nom\s*de\s*famille|nom\s*de\s*naissance|last\s*name|surname|family\s*name)/i,
  fullName: /(nom\s*complet|votre\s*nom|full\s*name|^nom$|^name$|participant|inscrit)/i,
  company: /(soci[ée]t[ée]|entreprise|organisation|organisme|company|employer|structure)/i,
  phone: /(t[ée]l[ée]phone|portable|mobile|phone|whatsapp)/i,
  email: /(e-?mail|courriel|adresse\s*[ée]lectronique)/i
} as const;

/**
 * Extrait un contact d'une réponse.
 *
 * Renvoie des chaînes vides plutôt que `undefined` : un contact sans téléphone
 * existe, un contact dont le téléphone vaut « undefined » à l'export n'existe
 * pas.
 */
export function extractContact(
  form: Pick<Form, 'fields'> | undefined,
  responses: Record<string, unknown> | null | undefined,
  fallbackEmail?: string | null
): ExtractedContact {
  const fields = (form?.fields ?? []) as Field[];
  const answers = responses ?? {};

  const value = (field: Field | undefined): string => {
    if (!field) return '';
    const raw = answers[field.id];
    if (typeof raw === 'string') return raw.trim();
    if (typeof raw === 'number') return String(raw);
    return '';
  };

  const labelOf = (field: Field): string =>
    `${pickText(field.label, 'fr')} ${pickText(field.label, 'en')}`.trim();

  const byType = (type: Field['type']): Field | undefined =>
    fields.find((field) => field.type === type && value(field) !== '');

  const byLabel = (pattern: RegExp, types: Field['type'][]): Field | undefined =>
    fields.find(
      (field) => types.includes(field.type) && pattern.test(labelOf(field)) && value(field) !== ''
    );

  const email = value(byType('email')) || value(byLabel(PATTERNS.email, ['short_text']));
  const phone = value(byType('phone')) || value(byLabel(PATTERNS.phone, ['short_text', 'number']));
  const company = value(byLabel(PATTERNS.company, ['short_text', 'dropdown', 'single_choice']));

  return {
    name: extractName(fields, value, labelOf),
    // Le repli est l'adresse déjà retenue à l'envoi : c'est elle qui a servi à
    // la confirmation, donc celle à laquelle la personne répond.
    email: email || (fallbackEmail ?? '').trim(),
    phone,
    company
  };
}

/**
 * Le nom, en recollant prénom et nom quand le formulaire les sépare.
 *
 * Deux champs distincts sont le cas le plus fréquent des bulletins
 * d'inscription, et un carnet d'adresses qui n'en garderait qu'un donnerait une
 * liste de prénoms.
 */
function extractName(
  fields: Field[],
  value: (field: Field | undefined) => string,
  labelOf: (field: Field) => string
): string {
  const textFields = fields.filter((field) => field.type === 'short_text');

  const first = textFields.find((field) => PATTERNS.firstName.test(labelOf(field)));
  const last = textFields.find((field) => PATTERNS.lastName.test(labelOf(field)));

  const joined = [value(first), value(last)].filter(Boolean).join(' ').trim();
  if (joined) return joined;

  const full = textFields.find((field) => PATTERNS.fullName.test(labelOf(field)));
  if (value(full)) return value(full);

  // Dernier recours : la première question texte remplie. Elle est fausse
  // parfois, mais une ligne nommée « Table de 6 » se corrige d'un clic, là où
  // une ligne vide oblige à rouvrir la réponse pour savoir de qui il s'agit.
  const firstFilled = textFields.find((field) => value(field) !== '');
  return value(firstFilled);
}

/**
 * Deux contacts désignent-ils la même personne ?
 *
 * Sur l'adresse, et uniquement sur elle : deux homonymes existent, deux
 * personnes derrière la même adresse presque jamais. C'est aussi la clé
 * d'unicité en base, et les deux doivent dire la même chose sous peine de voir
 * l'écran annoncer un ajout que la base refuse.
 */
export function contactKey(email: string): string {
  return email.trim().toLowerCase();
}
