/**
 * Formes de données renvoyées par Tally.
 *
 * Tally n'offre pas de schéma public stable : ces types décrivent ce que
 * l'API v1 renvoie aujourd'hui, et tout est optionnel là où l'observation
 * montre des variations. Le convertisseur ne suppose jamais qu'un champ existe.
 */

export interface TallyFormSummary {
  id: string;
  name: string;
  status?: string;
  numberOfSubmissions?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TallyBlockPayload {
  title?: string;
  label?: string;
  placeholder?: string;
  html?: string;
  text?: string;
  isRequired?: boolean;
  required?: boolean;
  options?: { id?: string; text?: string; label?: string }[];
  rows?: { id?: string; text?: string }[];
  columns?: { id?: string; text?: string }[];
  /** Bornes d'une échelle linéaire / NPS. */
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  /** Nombre d'étoiles d'une notation. */
  maxRating?: number;
  allowMultiple?: boolean;
  isMultiSelect?: boolean;
}

export interface TallyBlock {
  uuid: string;
  type: string;
  groupUuid?: string;
  groupType?: string;
  payload?: TallyBlockPayload;
}

export interface TallyFormDetail {
  id: string;
  name: string;
  status?: string;
  blocks?: TallyBlock[];
}

export interface TallyQuestion {
  id: string;
  type: string;
  title?: string;
  options?: { id: string; text: string }[];
}

export interface TallyAnswer {
  questionId: string;
  /** Tally renvoie selon le type : string, number, boolean, tableau d'ids… */
  value: unknown;
}

export interface TallySubmission {
  id: string;
  submittedAt?: string;
  isCompleted?: boolean;
  responses?: TallyAnswer[];
}

export interface TallySubmissionsPage {
  page?: number;
  limit?: number;
  hasMore?: boolean;
  totalNumberOfSubmissionsPerFilter?: Record<string, number>;
  questions?: TallyQuestion[];
  submissions?: TallySubmission[];
}

/** Résultat d'un import, tel qu'affiché à l'utilisateur. */
export interface TallyImportResult {
  formId: string;
  formTitle: string;
  fieldsImported: number;
  responsesImported: number;
  /** Points sur lesquels l'import a dû faire un compromis. */
  warnings: string[];
}
