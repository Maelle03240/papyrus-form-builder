// lib/validation/form-validation.ts — Validation des formulaires avant publication

import type { Field, Form } from '@/types';
import { FIELD_META } from '@/lib/field-meta';

export interface FormValidationError {
  fieldId: string;
  fieldLabel: string;
  error: string;
  severity: 'error' | 'warning';
}

/**
 * Valide un formulaire avant publication/sauvegarde
 */
export function validateForm(form: Form): FormValidationError[] {
  const errors: FormValidationError[] = [];

  if (!form.fields) return errors;

  // Validation des champs Media (image, vidéo, fichier)
  for (const field of form.fields) {
    if (field.type === 'image' || field.type === 'video' || field.type === 'file') {
      errors.push(...validateMediaField(field));
    }
    errors.push(...validatePhase2Field(field, form));
  }

  return errors;
}

/**
 * Champs de la phase 2 laissés à moitié configurés.
 *
 * Aucun d'eux ne provoque d'erreur à l'exécution : un lien sans adresse s'affiche
 * simplement sans destination, un total sans source reste à zéro. C'est
 * précisément ce qui les rend dangereux — ils partent en production sans rien
 * signaler, et c'est le répondant qui découvre le bouton mort.
 */
function validatePhase2Field(field: Field, form: Form): FormValidationError[] {
  const errors: FormValidationError[] = [];
  const label = () => field.label?.fr || FIELD_META[field.type].label;

  if (field.type === 'link' && !field.validation?.link_url?.trim()) {
    errors.push({
      fieldId: field.id,
      fieldLabel: label(),
      error: "Ce bouton n'a aucune destination : indiquez l'adresse vers laquelle il renvoie.",
      severity: 'error'
    });
  }

  if (field.type === 'hidden' && !field.validation?.hidden_key?.trim() && !field.validation?.hidden_default) {
    errors.push({
      fieldId: field.id,
      fieldLabel: label(),
      error: "Ce champ caché n'a ni clé d'URL ni valeur par défaut : il n'enregistrera jamais rien.",
      severity: 'warning'
    });
  }

  if (field.type === 'repeater' && (field.repeater?.fields?.length ?? 0) === 0) {
    errors.push({
      fieldId: field.id,
      fieldLabel: label(),
      error:
        "Ce bloc répétable n'a aucune sous-question : il ne s'affichera pas du tout sur le formulaire publié.",
      severity: 'error'
    });
  }

  if (field.type === 'calculated') {
    const sources = field.calc?.sources ?? [];
    if (sources.length === 0) {
      errors.push({
        fieldId: field.id,
        fieldLabel: label(),
        error: 'Ce total ne compte rien : choisissez au moins un champ source.',
        severity: 'error'
      });
    } else {
      // Une source supprimée depuis laisse un total qui ne bougera plus jamais,
      // sans que rien ne le distingue d'un total légitimement à zéro.
      const known = new Set((form.fields ?? []).map((candidate) => candidate.id));
      const missing = sources.filter((source) => !known.has(source));
      if (missing.length > 0) {
        errors.push({
          fieldId: field.id,
          fieldLabel: label(),
          error: `Ce total renvoie à ${missing.length} champ${missing.length > 1 ? 's' : ''} qui n'existe${missing.length > 1 ? 'nt' : ''} plus.`,
          severity: 'error'
        });
      }
    }
  }

  // Un verrou dont la question source a disparu ne s'ouvre jamais : le champ
  // reste invisible pour toujours, et personne ne comprend pourquoi.
  const conditions = field.visibility?.conditions ?? [];
  if (conditions.length > 0) {
    const known = new Set((form.fields ?? []).map((candidate) => candidate.id));
    const orphan = conditions.some((condition) => !known.has(condition.source_field_id));
    if (orphan) {
      errors.push({
        fieldId: field.id,
        fieldLabel: label(),
        error: "Une condition d'affichage renvoie à une question supprimée : ce champ ne s'affichera jamais.",
        severity: 'error'
      });
    }
  }

  return errors;
}

/**
 * Valide un champ Media (image, vidéo, fichier)
 */
function validateMediaField(field: Field): FormValidationError[] {
  const errors: FormValidationError[] = [];
  const creatorModeEnabled = field.validation?.creator_mode_enabled ?? false;
  const respondentModeEnabled = field.validation?.respondent_mode_enabled ?? false;

  // Aucun mode activé
  if (!creatorModeEnabled && !respondentModeEnabled) {
    const typeLabels = {
      image: 'Image',
      video: 'Vidéo',
      file: 'Fichier'
    };

    errors.push({
      fieldId: field.id,
      fieldLabel: field.label?.fr || `${typeLabels[field.type as keyof typeof typeLabels]} sans titre`,
      error: `Veuillez choisir au moins un mode (Créateur ou Répondant) pour ce champ ${typeLabels[field.type as keyof typeof typeLabels]}.`,
      severity: 'error'
    });
  }

  // Mode créateur activé mais pas de contenu pour image/vidéo
  if (creatorModeEnabled && !field.validation?.media_url && (field.type === 'image' || field.type === 'video')) {
    const typeLabel = field.type === 'image' ? 'image' : 'vidéo';
    errors.push({
      fieldId: field.id,
      fieldLabel: field.label?.fr || `${field.type} sans titre`,
      error: `Mode Créateur activé mais aucune ${typeLabel} n'a été ajoutée.`,
      severity: 'warning'
    });
  }

  return errors;
}

/**
 * Vérifie si un formulaire peut être publié (pas d'erreurs critiques)
 */
export function canPublishForm(form: Form): boolean {
  const errors = validateForm(form);
  return !errors.some(error => error.severity === 'error');
}

/**
 * Formatage des erreurs pour l'affichage
 */
export function formatValidationErrors(errors: FormValidationError[]): string {
  if (errors.length === 0) return '';

  const errorMessages = errors.map(error => `• ${error.fieldLabel}: ${error.error}`);
  return errorMessages.join('\n');
}