import type { Field, FieldOption, FieldType, MultilingualText } from '@/types';
import type {
  TallyBlock,
  TallyFormDetail,
  TallyQuestion,
  TallySubmissionsPage
} from './types';

/**
 * Traduction du modèle Tally vers le modèle Papyrus.
 *
 * Tally décrit un formulaire comme une liste plate de « blocs » : un titre de
 * question est un bloc, chacune de ses options en est un autre, et ils sont
 * reliés par un `groupUuid`. Papyrus, lui, imbrique les options dans le champ.
 * L'essentiel du travail ci-dessous consiste à regrouper puis à replier cette
 * liste plate.
 *
 * Ce qui n'a pas d'équivalent (paiements, signature, calculs Tally, logique
 * conditionnelle) est signalé dans `warnings` plutôt que silencieusement perdu.
 */

/** Correspondance des types de blocs Tally vers les types de champs Papyrus. */
const TYPE_MAP: Record<string, FieldType> = {
  INPUT_TEXT: 'short_text',
  INPUT_NUMBER: 'number',
  INPUT_EMAIL: 'email',
  INPUT_PHONE_NUMBER: 'phone',
  INPUT_LINK: 'url',
  INPUT_DATE: 'date',
  INPUT_TIME: 'short_text',
  TEXTAREA: 'long_text',
  MULTIPLE_CHOICE: 'single_choice',
  CHECKBOXES: 'multiple_choice',
  DROPDOWN: 'dropdown',
  MULTI_SELECT: 'multiple_choice',
  RANKING: 'multiple_choice',
  LINEAR_SCALE: 'nps',
  RATING: 'rating',
  MATRIX: 'matrix',
  FILE_UPLOAD: 'file',
  SIGNATURE: 'file',
  HIDDEN_FIELDS: 'short_text'
};

/** Blocs de mise en page : deviennent des champs non interrogatifs. */
const LAYOUT_TYPES = new Set([
  'FORM_TITLE',
  'TITLE',
  'HEADING_1',
  'HEADING_2',
  'HEADING_3',
  'TEXT',
  'LABEL',
  'DIVIDER',
  'PAGE_BREAK',
  'IMAGE',
  'EMBED',
  'VIDEO'
]);

/** Blocs sans équivalent dans Papyrus. */
const UNSUPPORTED_TYPES = new Set(['PAYMENT', 'CALCULATED_FIELDS', 'CAPTCHA', 'WALLET_CONNECT']);

function ml(value: string | undefined): MultilingualText {
  return { fr: (value ?? '').trim() };
}

/** Retire le HTML que Tally place dans les titres et textes riches. */
function stripHtml(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function blockTitle(block: TallyBlock): string {
  const payload = block.payload ?? {};
  return stripHtml(payload.title ?? payload.label ?? payload.html ?? payload.text);
}

export interface ConvertedForm {
  title: string;
  fields: Field[];
  warnings: string[];
  /** Correspondance identifiant Tally → identifiant Papyrus, pour les réponses. */
  fieldIdByTallyId: Map<string, string>;
}

/**
 * Convertit la structure d'un formulaire Tally.
 * `formId` est l'identifiant Papyrus déjà créé, auquel rattacher les champs.
 */
export function convertForm(detail: TallyFormDetail, formId: string): ConvertedForm {
  const warnings: string[] = [];
  const fieldIdByTallyId = new Map<string, string>();
  const fields: Field[] = [];

  const blocks = detail.blocks ?? [];

  // Tally éclate une question à choix en un bloc « question » suivi d'un bloc
  // par option, tous porteurs du même groupUuid. On regroupe d'abord.
  const groups = new Map<string, TallyBlock[]>();
  const order: string[] = [];

  for (const block of blocks) {
    const key = block.groupUuid ?? block.uuid;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(block);
  }

  const unsupportedSeen = new Set<string>();

  for (const key of order) {
    const group = groups.get(key)!;
    const head = group[0];
    const type = head.type?.toUpperCase() ?? '';

    if (UNSUPPORTED_TYPES.has(type)) {
      unsupportedSeen.add(type);
      continue;
    }

    // Le titre du formulaire n'est pas un champ.
    if (type === 'FORM_TITLE') continue;

    if (LAYOUT_TYPES.has(type)) {
      const text = group.map(blockTitle).filter(Boolean).join(' ');
      if (!text) continue;

      fields.push(
        makeField({
          formId,
          type: type.startsWith('HEADING') || type === 'TITLE' ? 'section_break' : 'statement',
          label: text,
          order: fields.length
        })
      );
      continue;
    }

    const papyrusType = TYPE_MAP[type];
    if (!papyrusType) {
      unsupportedSeen.add(type);
      continue;
    }

    const payload = head.payload ?? {};
    const label = group.map(blockTitle).find(Boolean) ?? 'Question importée';

    const field = makeField({
      formId,
      type: papyrusType,
      label,
      order: fields.length,
      required: payload.isRequired ?? payload.required ?? false,
      placeholder: stripHtml(payload.placeholder)
    });

    // Options : soit portées par le bloc de tête, soit par les blocs frères.
    const options = collectOptions(group);
    if (options.length > 0) {
      field.options = options;
    }

    if (papyrusType === 'matrix') {
      field.rows = (payload.rows ?? []).map((row, index) => ({
        id: row.id ?? `row-${index}`,
        label: ml(stripHtml(row.text))
      }));
      field.options = (payload.columns ?? []).map((column, index) => ({
        id: column.id ?? `col-${index}`,
        label: ml(stripHtml(column.text))
      }));
    }

    if (papyrusType === 'nps') {
      field.validation = {
        ...field.validation,
        min: payload.min ?? 0,
        max: payload.max ?? 10,
        ...(payload.minLabel && { nps_left_label: stripHtml(payload.minLabel) }),
        ...(payload.maxLabel && { nps_right_label: stripHtml(payload.maxLabel) })
      };
    }

    if (papyrusType === 'rating') {
      field.validation = { ...field.validation, max: payload.maxRating ?? 5 };
    }

    if (type === 'SIGNATURE') {
      warnings.push(
        `« ${label} » était une signature Tally : importée en champ fichier, les signatures déjà collectées ne sont pas transférables.`
      );
    }

    if (type === 'RANKING') {
      warnings.push(
        `« ${label} » était un classement Tally : importé en choix multiple, l'ordre des réponses est perdu.`
      );
    }

    fields.push(field);
    fieldIdByTallyId.set(head.uuid, field.id);
    // Les blocs frères partagent l'identifiant de question côté réponses.
    for (const sibling of group) {
      fieldIdByTallyId.set(sibling.uuid, field.id);
    }
    if (head.groupUuid) fieldIdByTallyId.set(head.groupUuid, field.id);
  }

  if (unsupportedSeen.size > 0) {
    warnings.push(
      `Blocs Tally sans équivalent, ignorés : ${Array.from(unsupportedSeen).join(', ')}.`
    );
  }

  warnings.push(
    "La logique conditionnelle Tally n'est pas transférable automatiquement : reconstruisez-la dans l'onglet Logique."
  );

  return {
    title: detail.name || 'Formulaire importé de Tally',
    fields,
    warnings,
    fieldIdByTallyId
  };
}

function collectOptions(group: TallyBlock[]): FieldOption[] {
  const fromPayload = group[0]?.payload?.options ?? [];
  if (fromPayload.length > 0) {
    return fromPayload.map((option, index) => ({
      id: option.id ?? `opt-${index}`,
      label: ml(stripHtml(option.text ?? option.label))
    }));
  }

  // Sinon, chaque bloc frère porte une option.
  return group
    .slice(1)
    .map((block, index) => ({
      id: block.uuid ?? `opt-${index}`,
      label: ml(blockTitle(block))
    }))
    .filter((option) => option.label.fr.length > 0);
}

function makeField(input: {
  formId: string;
  type: FieldType;
  label: string;
  order: number;
  required?: boolean;
  placeholder?: string;
}): Field {
  return {
    id: crypto.randomUUID(),
    form_id: input.formId,
    type: input.type,
    label: ml(input.label),
    description: ml(''),
    placeholder: ml(input.placeholder ?? ''),
    options: [],
    required: input.required ?? false,
    field_order: input.order,
    validation: {}
  };
}

export interface ConvertedSubmission {
  externalId: string;
  submittedAt: string;
  responses: Record<string, unknown>;
}

/**
 * Convertit les réponses Tally vers le format `{ champId: valeur }` de Papyrus.
 *
 * Tally identifie ses réponses par l'uuid du bloc question : on s'appuie sur la
 * table de correspondance construite pendant la conversion de la structure. Une
 * réponse dont la question n'a pas été importée est ignorée, jamais devinée.
 */
export function convertSubmissions(
  pages: TallySubmissionsPage[],
  fieldIdByTallyId: Map<string, string>,
  fields: Field[]
): ConvertedSubmission[] {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const questionsById = new Map<string, TallyQuestion>();

  for (const page of pages) {
    for (const question of page.questions ?? []) {
      questionsById.set(question.id, question);
    }
  }

  const results: ConvertedSubmission[] = [];

  for (const page of pages) {
    for (const submission of page.submissions ?? []) {
      const responses: Record<string, unknown> = {};

      for (const answer of submission.responses ?? []) {
        const fieldId = fieldIdByTallyId.get(answer.questionId);
        if (!fieldId) continue;

        const field = fieldsById.get(fieldId);
        if (!field) continue;

        const value = normalizeAnswer(answer.value, field, questionsById.get(answer.questionId));
        if (value !== null && value !== undefined && value !== '') {
          responses[fieldId] = value;
        }
      }

      if (Object.keys(responses).length === 0) continue;

      results.push({
        externalId: submission.id,
        submittedAt: submission.submittedAt ?? new Date().toISOString(),
        responses
      });
    }
  }

  return results;
}

/**
 * Ramène une valeur Tally au format attendu par le champ Papyrus.
 * Les choix arrivent sous forme d'identifiants d'options Tally : il faut les
 * retraduire en identifiants d'options Papyrus, sans quoi les graphiques
 * afficheraient des uuid bruts.
 */
function normalizeAnswer(value: unknown, field: Field, question: TallyQuestion | undefined): unknown {
  if (value === null || value === undefined) return null;

  const isChoiceField = ['single_choice', 'multiple_choice', 'dropdown'].includes(field.type);

  if (isChoiceField && question?.options) {
    const labelByTallyOptionId = new Map(question.options.map((o) => [o.id, o.text]));

    const toPapyrusOptionId = (tallyOptionId: unknown): string => {
      const raw = String(tallyOptionId);
      const label = labelByTallyOptionId.get(raw);
      if (!label) return raw;

      const match = field.options.find(
        (option) => option.label.fr.toLowerCase() === label.trim().toLowerCase()
      );
      return match?.id ?? label;
    };

    if (Array.isArray(value)) return value.map(toPapyrusOptionId);
    return toPapyrusOptionId(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : item));
  }

  if (typeof value === 'object') {
    // Tally renvoie les fichiers sous forme d'objets { url, name, ... }.
    const record = value as Record<string, unknown>;
    if (typeof record.url === 'string') return record.url;
    return JSON.stringify(value);
  }

  return value;
}
