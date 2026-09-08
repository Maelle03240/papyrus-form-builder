import { describe, expect, it } from 'vitest';

import {
  deservesOwnScreen,
  isConfiguredForRespondent,
  isLayoutField,
  isVisibleToRespondent,
  rendersOwnTitle
} from '@/lib/public-fields';
import type { Field, FieldType } from '@/types';

/**
 * Ce qu'un répondant voit.
 *
 * Le constructeur et la vue publique partagent leurs composants de champ, ce qui
 * fait qu'un état d'auteur peut fuir jusqu'au formulaire publié. C'est arrivé :
 * « Aucune source — choisissez ce qui doit être compté dans le panneau de
 * droite » s'affichait devant quelqu'un qui n'a pas de panneau de droite.
 *
 * Ces règles-là ne se vérifient pas au typage — un champ mal réglé est un champ
 * valide.
 */

function field(type: FieldType, extra: Partial<Field> = {}): Field {
  return {
    id: 'f1',
    type,
    label: { fr: 'Question' },
    description: { fr: '' },
    ...extra
  } as Field;
}

describe('champ non configuré', () => {
  it('un bloc répétable sans sous-question n’est pas montrable', () => {
    expect(isConfiguredForRespondent(field('repeater'))).toBe(false);
    expect(isVisibleToRespondent(field('repeater'))).toBe(false);
  });

  it('avec des sous-questions, il l’est', () => {
    const configured = field('repeater', {
      repeater: {
        min: 1,
        max: 5,
        item_label: { fr: 'Ligne' },
        fields: [{ id: 's1', type: 'short_text', label: { fr: 'Prénom' } }]
      }
    } as Partial<Field>);

    expect(isConfiguredForRespondent(configured)).toBe(true);
    expect(isVisibleToRespondent(configured)).toBe(true);
  });

  it('un total sans source ne compte rien, donc ne s’affiche pas', () => {
    expect(isVisibleToRespondent(field('calculated', { calc: { mode: 'sum', sources: [], offset: 0 } }))).toBe(
      false
    );
  });

  it('un total avec source s’affiche', () => {
    expect(
      isVisibleToRespondent(field('calculated', { calc: { mode: 'sum', sources: ['a'], offset: 0 } }))
    ).toBe(true);
  });

  it('un total marqué « ne pas montrer » reste caché', () => {
    // La case existait dans le constructeur et n'était honorée nulle part : le
    // total s'affichait quand même. La valeur, elle, continue d'être calculée.
    expect(
      isVisibleToRespondent(
        field('calculated', { calc: { mode: 'sum', sources: ['a'], offset: 0, hidden: true } })
      )
    ).toBe(false);
  });
});

describe('champ caché', () => {
  it('n’occupe jamais de place', () => {
    expect(isVisibleToRespondent(field('hidden'))).toBe(false);
    expect(deservesOwnScreen(field('hidden'))).toBe(false);
  });
});

describe('mise en page', () => {
  it('les six types de mise en page sont reconnus', () => {
    for (const type of ['statement', 'image', 'video', 'link', 'divider', 'hidden'] as FieldType[]) {
      expect(isLayoutField(type), type).toBe(true);
    }
    expect(isLayoutField('short_text')).toBe(false);
  });

  it('quatre d’entre eux portent déjà leur intitulé', () => {
    for (const type of ['statement', 'image', 'video', 'link'] as FieldType[]) {
      expect(rendersOwnTitle(type), type).toBe(true);
    }
    // Le mode « une question par écran » ajoutait son propre titre par-dessus :
    // l'intitulé apparaissait deux fois de suite.
    expect(rendersOwnTitle('short_text')).toBe(false);
    expect(rendersOwnTitle('divider')).toBe(false);
  });
});

describe('écran propre, en mode « une question à la fois »', () => {
  it('un séparateur n’en obtient pas', () => {
    // Il obtenait un écran vide et numéroté : le trait de séparation n'a aucun
    // sens quand ce qu'il séparait a disparu.
    expect(deservesOwnScreen(field('divider'))).toBe(false);
    // Mais il reste dans les modes où il sépare quelque chose.
    expect(isVisibleToRespondent(field('divider'))).toBe(true);
  });

  it('un texte libre en obtient un — c’est un écran de contenu', () => {
    expect(deservesOwnScreen(field('statement'))).toBe(true);
    expect(deservesOwnScreen(field('image'))).toBe(true);
  });

  it('une vraie question aussi', () => {
    expect(deservesOwnScreen(field('short_text'))).toBe(true);
    expect(deservesOwnScreen(field('single_choice'))).toBe(true);
  });
});
