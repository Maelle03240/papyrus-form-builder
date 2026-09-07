import { describe, it, expect } from 'vitest';
import { buildPages, getFieldsInSameSection, getSections, flattenFields } from '@/lib/sections';
import type { Field, Section } from '@/types';

/**
 * Le découpage en sections était auparavant deviné : le rendu cherchait des
 * pseudo-champs `section_break` dans une liste plate. Il est maintenant lu.
 *
 * Ces tests fixent la propriété dont dépend tout le rendu public :
 * `field_order` est **relatif à sa section**. Trier les champs sur ce seul
 * critère entrelacerait les sections, et le répondant verrait les questions dans
 * le désordre — sans la moindre erreur pour le signaler.
 */

function section(id: string, order: number, title = ''): Section {
  return {
    id,
    form_id: 'form-1',
    title: { fr: title },
    description: { fr: '' },
    section_order: order
  };
}

function field(id: string, sectionId: string, order: number): Field {
  return {
    id,
    form_id: 'form-1',
    section_id: sectionId,
    type: 'short_text',
    label: { fr: id },
    description: { fr: '' },
    placeholder: { fr: '' },
    options: [],
    required: false,
    field_order: order,
    validation: {}
  };
}

describe('buildPages', () => {
  const sections = [section('s2', 1, 'Deuxième'), section('s1', 0, 'Première')];
  const fields = [
    field('b', 's1', 1),
    field('a', 's1', 0),
    field('c', 's2', 0)
  ];

  it('rend les sections dans l’ordre, indépendamment de l’ordre reçu', () => {
    const pages = buildPages({ sections, fields });
    expect(pages.map((page) => page.id)).toEqual(['s1', 's2']);
  });

  it('trie les champs à l’intérieur de chaque section', () => {
    const pages = buildPages({ sections, fields });
    expect(pages[0].fields.map((f) => f.id)).toEqual(['a', 'b']);
    expect(pages[1].fields.map((f) => f.id)).toEqual(['c']);
  });

  it('n’entrelace pas deux sections dont les rangs se recouvrent', () => {
    // Le piège exact : « a » et « c » portent tous deux field_order 0. Un tri
    // global les mettrait côte à côte, en travers des sections.
    const pages = buildPages({ sections, fields });
    expect(pages.flatMap((page) => page.fields.map((f) => f.id))).toEqual(['a', 'b', 'c']);
  });

  it('rattache à la première section un champ dont la section a disparu', () => {
    // Un champ orphelin ne doit pas s'évaporer du rendu : son auteur doit
    // pouvoir le retrouver pour le déplacer.
    const orphan = field('perdu', 'section-supprimee', 0);
    const pages = buildPages({ sections, fields: [...fields, orphan] });

    expect(pages[0].fields.map((f) => f.id)).toContain('perdu');
    expect(pages.flatMap((page) => page.fields)).toHaveLength(4);
  });

  it('synthétise une section quand le formulaire n’en porte aucune', () => {
    // Cas d'un formulaire construit en mémoire et jamais enregistré — l'aperçu
    // d'un modèle. Sans ce repli, il n'afficherait rien.
    const pages = buildPages({ sections: [], fields });
    expect(pages).toHaveLength(1);
    expect(pages[0].fields).toHaveLength(3);
  });

  it('conserve une section vide comme page à part entière', () => {
    const pages = buildPages({ sections: [...sections, section('s3', 2)], fields });
    expect(pages).toHaveLength(3);
    expect(pages[2].fields).toEqual([]);
  });
});

describe('getFieldsInSameSection', () => {
  const sections = [section('s1', 0), section('s2', 1)];
  const fields = [
    field('a', 's1', 0),
    field('b', 's1', 1),
    field('c', 's2', 0)
  ];

  it('ne renvoie que les voisins de la même section, sans le champ source', () => {
    expect(getFieldsInSameSection({ sections, fields }, 'a').map((f) => f.id)).toEqual(['b']);
  });

  it('renvoie une liste vide pour un champ inconnu', () => {
    expect(getFieldsInSameSection({ sections, fields }, 'inexistant')).toEqual([]);
  });

  it('n’expose jamais un champ d’une autre section', () => {
    // Afficher ou masquer un champ d'une autre page n'aurait aucun effet
    // visible : cette page n'est pas à l'écran.
    expect(getFieldsInSameSection({ sections, fields }, 'c')).toEqual([]);
  });
});

describe('getSections', () => {
  it('trie les sections par leur rang', () => {
    const sections = [section('s3', 2), section('s1', 0), section('s2', 1)];
    expect(getSections({ sections }).map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });

  it('ne modifie pas le tableau reçu', () => {
    const sections = [section('s2', 1), section('s1', 0)];
    getSections({ sections });
    expect(sections.map((s) => s.id)).toEqual(['s2', 's1']);
  });
});

describe('flattenFields', () => {
  it('remet les champs dans l’ordre de lecture', () => {
    const pages = [
      { ...section('s2', 1), fields: [field('c', 's2', 0)] },
      { ...section('s1', 0), fields: [field('b', 's1', 1), field('a', 's1', 0)] }
    ];
    expect(flattenFields(pages).map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });
});
