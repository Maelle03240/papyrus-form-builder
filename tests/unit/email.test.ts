import { describe, it, expect } from 'vitest';

import {
  chooseEmailMessage,
  emailTokens,
  fallbackMessage,
  pickText,
  renderTemplate,
  repeaterToken,
  sampleResponses
} from '@/lib/email/tokens';
import { htmlToText, parseAddressList } from '@/lib/email/send';
import { findConfirmationRecipient } from '@/lib/email/confirmation';
import { normalizeProjectInvoicing } from '@/lib/store/projects';
import type { EmailConfig, Field, FieldOption, Form, TotalsSnapshot } from '@/types';

/**
 * Ce que fixent ces tests part dans la boîte d'un client.
 *
 * Deux propriétés comptent plus que le reste. La première : une valeur insérée
 * dans un corps HTML vient du répondant, donc elle est échappée — sans quoi un
 * nom mal choisi déforme le message de tous les suivants. La seconde : une règle
 * sans condition ne s'applique jamais, parce qu'elle correspondrait à tout et
 * masquerait en silence toutes celles qui la suivent.
 */

function option(id: string, label: string): FieldOption {
  return { id, label: { fr: label } };
}

function field(id: string, type: Field['type'], extra: Partial<Field> = {}): Field {
  return {
    id,
    form_id: 'form-1',
    section_id: 's1',
    type,
    label: { fr: id },
    description: { fr: '' },
    placeholder: { fr: '' },
    options: [],
    required: false,
    field_order: 0,
    validation: {},
    ...extra
  };
}

function form(fields: Field[], extra: Partial<Form> = {}): Form {
  return {
    id: 'form-1',
    team_id: 'team-1',
    title: 'Gala annuel',
    slug: 'gala',
    display_mode: 'scroll',
    status: 'published',
    is_template: false,
    theme: {} as Form['theme'],
    access_type: 'public',
    languages: ['fr'],
    default_language: 'fr',
    fields,
    created_at: '2026-09-07T10:00:00.000Z',
    updated_at: '2026-09-07T10:00:00.000Z',
    ...extra
  };
}

const CONTEXT_DATE = '2026-09-07T10:00:00.000Z';

// ============================================================================
// Jetons
// ============================================================================

describe('emailTokens', () => {
  it('propose les informations, puis les questions', () => {
    const tokens = emailTokens(form([field('prenom', 'short_text')]));

    expect(tokens.filter((t) => t.group === 'Informations').map((t) => t.token)).toContain(
      'invoice_number'
    );
    expect(tokens.find((t) => t.token === 'prenom')?.group).toBe('Réponses');
  });

  it("n'offre pas les champs qui n'ont pas de valeur lisible", () => {
    // Une signature est une image et un fichier une adresse : les déposer dans
    // une phrase produirait une URL au milieu du texte.
    const tokens = emailTokens(
      form([field('sig', 'signature'), field('doc', 'file'), field('nom', 'short_text')])
    );

    expect(tokens.map((t) => t.token)).not.toContain('sig');
    expect(tokens.map((t) => t.token)).not.toContain('doc');
    expect(tokens.map((t) => t.token)).toContain('nom');
  });

  it('offre les sous-questions d’un répéteur, sur sa première ligne', () => {
    const repeater = field('participants', 'repeater', {
      repeater: {
        min: 1,
        max: 4,
        item_label: { fr: 'Participant' },
        fields: [
          {
            id: 'nom',
            type: 'short_text',
            label: { fr: 'Nom' },
            description: { fr: '' },
            placeholder: { fr: '' },
            options: [],
            required: false,
            validation: {}
          }
        ]
      }
    });

    const tokens = emailTokens(form([repeater]));
    const token = tokens.find((t) => t.token === repeaterToken('participants', 'nom'));

    expect(token).toBeDefined();
    expect(token?.label).toBe('Nom (Participant 1)');
  });
});

describe('renderTemplate', () => {
  const base = form([
    field('prenom', 'short_text'),
    field('formule', 'single_choice', {
      options: [option('o-table', 'Table de 6'), option('o-place', 'Place seule')]
    })
  ]);

  const context = {
    form: base,
    responses: { prenom: 'Livinia', formule: 'o-table' },
    submittedAt: CONTEXT_DATE,
    invoiceNumber: 'CMD-0042',
    projectName: 'Gala 2026'
  };

  it('remplace les jetons intégrés', () => {
    expect(renderTemplate('Bon {{invoice_number}} — {{project_name}}', context)).toBe(
      'Bon CMD-0042 — Gala 2026'
    );
    expect(renderTemplate('{{form_title}}', context)).toBe('Gala annuel');
  });

  it('résout un identifiant de champ, tirets compris', () => {
    // Les identifiants Papyrus sont des UUID, donc ils contiennent des tirets.
    // Un motif de jeton limité à `\w` ne les reconnaissait pas : le jeton
    // partait tel quel dans l'e-mail du client, et la seule façon de s'en
    // apercevoir était de lire un message reçu.
    const uuid = 'ea92b44b-d0e7-493f-9304-52d19696ee03';
    const withUuid = form([field(uuid, 'short_text')]);

    expect(
      renderTemplate(`Bonjour {{${uuid}}}`, {
        form: withUuid,
        responses: { [uuid]: 'Livinia' },
        submittedAt: CONTEXT_DATE
      })
    ).toBe('Bonjour Livinia');
  });

  it('rend le libellé d’une option, pas son identifiant', () => {
    expect(renderTemplate('{{formule}}', context)).toBe('Table de 6');
  });

  it('laisse un jeton inconnu intact', () => {
    // Un corps collé depuis un autre outil peut porter ses propres accolades :
    // les vider casserait un gabarit sans rien dire.
    expect(renderTemplate('{{ params.externe }}', context)).toBe('{{ params.externe }}');
  });

  it('échappe la valeur insérée dans un corps HTML', () => {
    const hostile = { ...context, responses: { prenom: '<b>Livinia</b>', formule: 'o-table' } };

    expect(renderTemplate('<p>Bonjour {{prenom}}</p>', hostile, { html: true })).toBe(
      '<p>Bonjour &lt;b&gt;Livinia&lt;/b&gt;</p>'
    );
  });

  it("n'échappe pas l'objet, qui n'est pas du HTML", () => {
    const hostile = { ...context, responses: { prenom: 'Ben & Co', formule: 'o-table' } };

    expect(renderTemplate('Bonjour {{prenom}}', hostile)).toBe('Bonjour Ben & Co');
  });

  it('résout une sous-question de répéteur sur la ligne demandée', () => {
    const withRepeater = form([
      field('participants', 'repeater', {
        repeater: {
          min: 1,
          max: 4,
          item_label: { fr: 'Participant' },
          fields: [
            {
              id: 'nom',
              type: 'short_text',
              label: { fr: 'Nom' },
              description: { fr: '' },
              placeholder: { fr: '' },
              options: [],
              required: false,
              validation: {}
            }
          ]
        }
      })
    ]);

    const rendered = renderTemplate('{{participants.0.nom}} et {{participants.1.nom}}', {
      form: withRepeater,
      responses: { participants: [{ nom: 'Ana' }, { nom: 'Bruno' }] },
      submittedAt: CONTEXT_DATE
    });

    expect(rendered).toBe('Ana et Bruno');
  });

  it('rend le total quand il y en a un, et rien sinon', () => {
    const totals = {
      currency: 'MUR',
      currency_position: 'before',
      lines: [],
      subtotal: 3000,
      discount: 0,
      discount_percent: 0,
      discount_code: '',
      vat: 0,
      vat_rate: 0,
      total: 3000,
      subtotal_label: 'Sous-total',
      discount_label: 'Remise',
      vat_label: 'TVA',
      total_label: 'Total'
    } satisfies TotalsSnapshot;

    expect(renderTemplate('{{total}}', { ...context, pricing: totals })).toContain('3');
    expect(renderTemplate('{{total}}', context)).toBe('');
  });

  it('écarte les questions sans réponse de la liste complète', () => {
    // Une liste où la moitié des lignes dit « — » se lit comme un formulaire mal
    // rempli, alors que ce sont des questions jamais affichées.
    const rendered = renderTemplate('{{all_answers}}', {
      form: base,
      responses: { prenom: 'Livinia' },
      submittedAt: CONTEXT_DATE
    });

    expect(rendered).toContain('Livinia');
    expect(rendered).not.toContain('formule');
  });
});

describe('sampleResponses', () => {
  it('remplit chaque question de son propre libellé', () => {
    const sample = sampleResponses(form([field('prenom', 'short_text')]));
    expect(sample.prenom).toBe('[prenom]');
  });
});

// ============================================================================
// Choix du message
// ============================================================================

describe('chooseEmailMessage', () => {
  const defaultMessage = { subject: { fr: 'Défaut' }, body: { fr: '<p>Défaut</p>' } };

  const config: EmailConfig = {
    enabled: true,
    default_message: defaultMessage,
    rules: [
      {
        id: 'r-vide',
        label: 'En cours de rédaction',
        message: { subject: { fr: 'Vide' }, body: { fr: '' } }
      },
      {
        id: 'r-table',
        label: 'Table',
        when: {
          operator: 'AND',
          conditions: [{ source_field_id: 'formule', operator: 'equals', value: 'o-table' }]
        },
        message: { subject: { fr: 'Table' }, body: { fr: '<p>Table</p>' } }
      },
      {
        id: 'r-toujours',
        label: 'Toujours',
        when: {
          operator: 'AND',
          conditions: [{ source_field_id: 'formule', operator: 'is_filled', value: '' }]
        },
        message: { subject: { fr: 'Toujours' }, body: { fr: '<p>Toujours</p>' } }
      }
    ]
  };

  it('ignore une règle sans condition', () => {
    // Elle correspondrait à tout et masquerait celles qui la suivent.
    const { message } = chooseEmailMessage(config, { formule: 'o-table' });
    expect(message.subject.fr).toBe('Table');
  });

  it('retient la première règle qui correspond, pas la plus précise', () => {
    // L'ordre est une décision de l'auteur : les deux dernières règles
    // correspondent, et c'est celle du haut qui gagne.
    const { message, ruleLabel } = chooseEmailMessage(config, { formule: 'o-table' });
    expect(ruleLabel).toBe('Table');
    expect(message.subject.fr).not.toBe('Toujours');
  });

  it('retombe sur le message par défaut quand rien ne correspond', () => {
    const { message, ruleLabel } = chooseEmailMessage(config, {});
    expect(message.subject.fr).toBe('Défaut');
    expect(ruleLabel).toBeNull();
  });
});

describe('pickText', () => {
  it('replie sur le français quand la langue demandée est absente', () => {
    expect(pickText({ fr: 'Bonjour' }, 'en')).toBe('Bonjour');
    expect(pickText({ fr: 'Bonjour', en: 'Hello' }, 'en')).toBe('Hello');
    expect(pickText(undefined, 'fr')).toBe('');
  });
});

describe('fallbackMessage', () => {
  it('cite le numéro quand il y en a un', () => {
    const withNumber = fallbackMessage({
      invoiceNumber: 'CMD-0007',
      projectName: 'Gala',
      formTitle: 'Inscription'
    });
    expect(withNumber.subject).toContain('CMD-0007');
    expect(withNumber.html).toContain('CMD-0007');

    const without = fallbackMessage({ formTitle: 'Inscription' });
    expect(without.subject).toContain('Inscription');
  });
});

// ============================================================================
// Envoi
// ============================================================================

describe('parseAddressList', () => {
  it('découpe une saisie libre et écarte ce qui n’est pas une adresse', () => {
    expect(parseAddressList('a@x.fr, b@y.fr ; pas-une-adresse\nc@z.fr')).toEqual([
      'a@x.fr',
      'b@y.fr',
      'c@z.fr'
    ]);
    expect(parseAddressList(undefined)).toEqual([]);
  });
});

describe('htmlToText', () => {
  it('produit un repli lisible, listes comprises', () => {
    const text = htmlToText('<p>Bonjour</p><ul><li>Un</li><li>Deux</li></ul>');
    expect(text).toContain('Bonjour');
    expect(text).toContain('- Un');
    expect(text).not.toContain('<');
  });
});

// ============================================================================
// Numérotation
// ============================================================================

describe('normalizeProjectInvoicing', () => {
  it('applique les valeurs par défaut sur une ligne vide', () => {
    expect(normalizeProjectInvoicing({})).toEqual({ prefix: 'CMD', next: 1, pad: 4 });
  });

  it('accepte un compteur rendu en chaîne', () => {
    // PostgREST rend les `bigint` en texte pour ne pas les tronquer au passage
    // par un nombre JavaScript.
    expect(normalizeProjectInvoicing({ invoice_next: '128' }).next).toBe(128);
  });

  it('borne le nombre de chiffres', () => {
    expect(normalizeProjectInvoicing({ invoice_pad: 0 }).pad).toBe(1);
    expect(normalizeProjectInvoicing({ invoice_pad: 99 }).pad).toBe(8);
  });
});

// ============================================================================
// Destinataire
// ============================================================================

describe('findConfirmationRecipient', () => {
  const branched = form([
    field('choix', 'yesno'),
    field('email_oui', 'email', {
      visibility: {
        operator: 'AND',
        conditions: [{ source_field_id: 'choix', operator: 'equals', value: 'yes' }]
      }
    }),
    field('email_non', 'email', {
      visibility: {
        operator: 'AND',
        conditions: [{ source_field_id: 'choix', operator: 'equals', value: 'no' }]
      }
    })
  ]);

  it('écrit à la branche réellement suivie', () => {
    // Un formulaire à deux branches porte souvent un champ e-mail dans chacune.
    // Écrire à celui de la branche abandonnée reviendrait à écrire à une adresse
    // que le répondant n'a pas saisie — celle d'un aller-retour dans le
    // formulaire, restée en mémoire.
    const responses = {
      choix: 'no',
      email_oui: 'ancienne@exemple.fr',
      email_non: 'bonne@exemple.fr'
    };

    expect(findConfirmationRecipient(branched, responses)).toBe('bonne@exemple.fr');
  });

  it('honore le champ désigné', () => {
    const both = form([field('pro', 'email'), field('perso', 'email')]);
    const responses = { pro: 'pro@exemple.fr', perso: 'perso@exemple.fr' };

    expect(findConfirmationRecipient(both, responses, 'perso')).toBe('perso@exemple.fr');
  });

  it("se rabat sur une adresse masquée plutôt que de n'écrire à personne", () => {
    // Une réponse ancienne, enregistrée avant que la règle n'existe, garde son
    // adresse dans un champ devenu invisible. Ne rien envoyer serait pire.
    const responses = { choix: 'yes', email_non: 'seule@exemple.fr' };

    expect(findConfirmationRecipient(branched, responses)).toBe('seule@exemple.fr');
  });

  it('renvoie null quand aucune adresse n’a été saisie', () => {
    expect(findConfirmationRecipient(branched, { choix: 'yes' })).toBeNull();
  });
});
