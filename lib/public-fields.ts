import type { Field, FieldType } from '@/types';

/**
 * Ce qu'un répondant doit voir, et ce qu'il ne doit pas.
 *
 * Le constructeur et la vue publique partagent leurs composants de champ. C'est
 * voulu — l'auteur voit exactement ce que le répondant verra — mais cela crée
 * une catégorie de défaut qu'aucun type ne rattrape : un état qui n'a de sens
 * que pour l'auteur finit à l'écran du répondant. « Aucune source — choisissez
 * ce qui doit être compté dans le panneau de droite » s'affichait ainsi sur un
 * formulaire publié, devant quelqu'un qui n'a pas de panneau de droite.
 *
 * Trois notions, séparées parce qu'elles ne répondent pas à la même question :
 *
 * · **configuré** — l'auteur a-t-il fini de le régler ? Un bloc répétable sans
 *   sous-question et un champ calculé sans source ne calculent rien. Ils ont
 *   quelque chose à dire à l'auteur, rien à demander au répondant ;
 * · **pose une question** — y a-t-il une réponse à donner ? Un séparateur et un
 *   champ caché n'en posent aucune ;
 * · **porte son propre titre** — le composant affiche-t-il déjà l'intitulé ? Un
 *   texte libre, une image, une vidéo et un lien le font. Le mode « une question
 *   par écran » ajoutait le sien par-dessus, et l'intitulé apparaissait deux
 *   fois de suite.
 */

/** Ni question ni réponse : de la mise en page. */
const LAYOUT_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'statement',
  'image',
  'video',
  'link',
  'divider',
  'hidden'
]);

/** Les types dont le rendu affiche déjà l'intitulé du champ. */
const SELF_TITLED_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'statement',
  'image',
  'video',
  'link'
]);

export function isLayoutField(type: FieldType): boolean {
  return LAYOUT_TYPES.has(type);
}

export function rendersOwnTitle(type: FieldType): boolean {
  return SELF_TITLED_TYPES.has(type);
}

/**
 * Le champ est-il utilisable tel qu'il est réglé ?
 *
 * Faux uniquement pour les deux types qui ont besoin d'une configuration pour
 * exister : sans elle, ils n'affichent qu'un message d'auteur.
 */
export function isConfiguredForRespondent(field: Field): boolean {
  if (field.type === 'repeater') {
    return (field.repeater?.fields ?? []).length > 0;
  }

  if (field.type === 'calculated') {
    return (field.calc?.sources ?? []).length > 0;
  }

  return true;
}

/**
 * Le champ mérite-t-il sa place dans la vue publique ?
 *
 * Un champ caché n'y a jamais eu la sienne : sa valeur vient de l'URL et il est
 * déjà en mémoire. Un champ mal réglé non plus — mieux vaut une question de
 * moins qu'une case qui ne compte rien.
 */
export function isVisibleToRespondent(field: Field): boolean {
  if (field.type === 'hidden') return false;

  // « Calculer sans montrer » : l'auteur peut vouloir un total qui n'intéresse
  // que lui. La case existait dans le constructeur et n'était honorée nulle
  // part — le total s'affichait quand même. La valeur, elle, continue d'être
  // calculée et enregistrée : c'est l'affichage qu'on retire, pas le calcul.
  if (field.type === 'calculated' && field.calc?.hidden) return false;

  return isConfiguredForRespondent(field);
}

/**
 * Le champ mérite-t-il un écran à lui, en mode « une question par écran » ?
 *
 * Un séparateur en obtenait un : un écran vide, numéroté, qu'il fallait passer.
 * Le trait de séparation n'a aucun sens quand il n'y a qu'une question à
 * l'écran — c'est justement ce qu'il sépare qui a disparu.
 */
export function deservesOwnScreen(field: Field): boolean {
  if (field.type === 'divider') return false;
  return isVisibleToRespondent(field);
}
