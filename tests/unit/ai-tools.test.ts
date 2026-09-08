import { describe, it, expect } from 'vitest';

import { TOOLS, TOOLS_BY_NAME, runTool, toolsForOpenAI, type ToolContext } from '@/lib/ai/tools';

/**
 * Ce que fixent ces tests : l'IA ne peut pas écrire n'importe quoi.
 *
 * C'est toute la différence avec l'ancienne route `/api/generate-form`, qui
 * demandait un objet JSON complet à un modèle et l'importait tel quel. Un champ
 * d'un type inventé, une question à choix sans choix, une règle logique qui
 * pointe dans le vide : rien ne les arrêtait. Ici chaque appel passe par un
 * schéma Zod, puis par des garde-fous qui connaissent le produit.
 *
 * Les refus comptent plus que les succès. Un outil qui accepte trop produit un
 * formulaire cassé que personne ne voit avant sa publication.
 */

// ============================================================================
// Un faux client Supabase
//
// Il ne simule pas PostgreSQL : il rend ce qu'on lui dit de rendre, et note ce
// qui lui a été demandé. C'est suffisant, parce que ce qu'on teste ici est la
// décision PRISE AVANT la requête — refuser, compléter, réordonner.
// ============================================================================

interface Recorded {
  table: string;
  op: string;
  payload?: unknown;
}

function fakeClient(results: Record<string, unknown> = {}) {
  const calls: Recorded[] = [];

  function builder(table: string) {
    let op = 'select';
    let payload: unknown;

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (row: unknown) => {
        op = 'insert';
        payload = row;
        calls.push({ table, op, payload });
        return chain;
      },
      update: (row: unknown) => {
        op = 'update';
        payload = row;
        calls.push({ table, op, payload });
        return chain;
      },
      upsert: (row: unknown) => {
        op = 'upsert';
        payload = row;
        calls.push({ table, op, payload });
        return chain;
      },
      delete: () => {
        op = 'delete';
        calls.push({ table, op });
        return chain;
      },
      maybeSingle: async () => resolve(table, op),
      single: async () => resolve(table, op),
      then: (onFulfilled: (value: unknown) => unknown) =>
        Promise.resolve(resolve(table, op)).then(onFulfilled)
    };

    return chain;
  }

  function resolve(table: string, op: string) {
    const key = `${table}.${op}`;
    if (key in results) return results[key] as Record<string, unknown>;
    if (table in results) return results[table] as Record<string, unknown>;
    return { data: null, error: null, count: 0 };
  }

  return { client: { from: builder } as never, calls };
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  const { client } = fakeClient();
  return {
    supabase: client,
    teamId: 'team-1',
    userId: 'user-1',
    projectId: 'project-1',
    formId: 'form-1',
    ...overrides
  };
}

// ============================================================================
// Le catalogue
// ============================================================================

describe('le catalogue d’outils', () => {
  it('couvre les neuf familles annoncées au plan', () => {
    const names = new Set(TOOLS.map((tool) => tool.name));

    for (const expected of [
      // Projet
      'create_project',
      'set_project_modules',
      'set_branding',
      // Formulaire
      'create_form',
      'rename_form',
      // Structure
      'add_section',
      'update_section',
      'move_section',
      'delete_section',
      // Champs
      'add_field',
      'update_field',
      'set_options',
      'set_validation',
      'set_visibility',
      'move_field',
      'delete_field',
      // Logique
      'add_logic_rule',
      'delete_logic_rule',
      // Tarification
      'enable_pricing',
      'set_currency_vat',
      'price_option',
      'add_discount_code',
      'set_tiers',
      // E-mail
      'set_email_default',
      'add_email_rule',
      // Partenaires
      'enable_partners',
      'create_partner',
      'link_partner_to_project',
      // Intégrations
      'connect_sheet',
      'map_columns'
    ]) {
      expect(names, `outil manquant : ${expected}`).toContain(expected);
    }
  });

  it('donne à l’IA de quoi LIRE avant d’écrire', () => {
    // Sans outil de lecture, le modèle ne connaît aucun identifiant de question
    // et doit en inventer pour écrire une règle logique ou un prix — exactement
    // ce que cette architecture existe pour empêcher.
    expect(TOOLS_BY_NAME.has('describe_form')).toBe(true);
    expect(TOOLS_BY_NAME.has('describe_project')).toBe(true);
  });

  it('produit un schéma JSON exploitable pour chaque outil', () => {
    const declared = toolsForOpenAI();

    expect(declared).toHaveLength(TOOLS.length);

    for (const tool of declared) {
      expect(tool.type).toBe('function');
      expect(tool.name).toMatch(/^[a-z_]+$/);
      // Une description vide laisse le modèle deviner à quoi sert l'outil.
      expect(String(tool.description).length).toBeGreaterThan(20);
      expect(tool.parameters).toHaveProperty('type', 'object');
    }
  });

  it('ne déclare pas deux fois le même nom', () => {
    // Deux outils homonymes : le second écrase le premier dans la table de
    // correspondance, et l'IA appelle l'un en croyant appeler l'autre.
    expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length);
  });

  it('marque comme modifiants les seuls outils qui touchent le formulaire', () => {
    // C'est ce drapeau qui déclenche l'instantané. Un outil de lecture marqué
    // modifiant produirait un instantané par question posée ; un outil d'écriture
    // qui ne l'est pas rendrait son tour impossible à annuler.
    expect(TOOLS_BY_NAME.get('describe_form')?.mutates).toBe(false);
    expect(TOOLS_BY_NAME.get('add_field')?.mutates).toBe(true);
    expect(TOOLS_BY_NAME.get('delete_field')?.mutates).toBe(true);
  });
});

// ============================================================================
// La validation
// ============================================================================

describe('runTool', () => {
  it('refuse un outil inconnu sans rien casser', async () => {
    const result = await runTool('supprime_tout', {}, context());
    expect(result.ok).toBe(false);
    expect(result.message).toContain('supprime_tout');
  });

  it('rend au modèle la raison exacte du refus', async () => {
    // Le modèle doit pouvoir corriger son appel suivant : « paramètres
    // invalides » ne lui apprend rien.
    const result = await runTool('add_field', { type: 'télépathie', label: 'X' }, context());

    expect(result.ok).toBe(false);
    expect(result.message).toContain('type');
  });

  it('refuse un identifiant qui n’est pas un identifiant', async () => {
    const result = await runTool('delete_field', { field_id: 'la troisième question' }, context());
    expect(result.ok).toBe(false);
  });

  it('n’explose jamais : une erreur d’exécution devient un résultat', async () => {
    const broken = context({
      supabase: {
        from() {
          throw new Error('base injoignable');
        }
      } as never
    });

    const result = await runTool('describe_form', {}, broken);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('describe_form');
  });
});

// ============================================================================
// Les garde-fous qui connaissent le produit
// ============================================================================

describe('add_field', () => {
  it('refuse une question à choix sans aucun choix', async () => {
    // Écrite vide, elle s'afficherait au répondant comme un bloc muet, et le
    // défaut ne se verrait qu'en ouvrant le formulaire public.
    const result = await runTool(
      'add_field',
      { type: 'single_choice', label: 'Formule', section_id: '11111111-1111-4111-8111-111111111111' },
      context()
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('option');
  });

  it('accepte un libellé en texte simple comme en objet par langue', async () => {
    const { client, calls } = fakeClient({
      'sections.select': { data: { id: 'sec-1' }, error: null },
      'fields.select': { data: { field_order: 2 }, error: null },
      'fields.insert': { data: { id: 'field-9' }, error: null }
    });

    const result = await runTool(
      'add_field',
      { type: 'short_text', label: 'Votre nom' },
      context({ supabase: client })
    );

    expect(result.ok).toBe(true);

    const insert = calls.find((call) => call.table === 'fields' && call.op === 'insert');
    // Demander `{"fr": …}` pour chaque libellé triplerait la taille de chaque
    // appel et multiplierait les occasions de se tromper de forme.
    expect((insert?.payload as { label: Record<string, string> }).label).toEqual({ fr: 'Votre nom' });
  });

  it('range la question à la suite des autres, jamais en doublon de rang', async () => {
    const { client, calls } = fakeClient({
      'sections.select': { data: { id: 'sec-1' }, error: null },
      'fields.select': { data: { field_order: 4 }, error: null },
      'fields.insert': { data: { id: 'field-9' }, error: null }
    });

    await runTool('add_field', { type: 'email', label: 'E-mail' }, context({ supabase: client }));

    const insert = calls.find((call) => call.table === 'fields' && call.op === 'insert');
    expect((insert?.payload as { field_order: number }).field_order).toBe(5);
  });
});

describe('add_logic_rule', () => {
  it('refuse une action qui n’a nulle part où agir', async () => {
    const result = await runTool(
      'add_logic_rule',
      {
        conditions: [
          {
            source_field_id: '11111111-1111-4111-8111-111111111111',
            operator: 'equals',
            value: 'oui'
          }
        ],
        action_type: 'show_field'
      },
      context()
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('target_field_id');
  });

  it('accepte end_form sans cible — il n’en a pas besoin', async () => {
    const { client } = fakeClient({
      'fields.select': { data: [{ id: '11111111-1111-4111-8111-111111111111' }], error: null },
      'logic_rules.select': { data: { rule_order: 0 }, error: null },
      'logic_rules.insert': { data: { id: 'rule-1' }, error: null }
    });

    const result = await runTool(
      'add_logic_rule',
      {
        conditions: [
          {
            source_field_id: '11111111-1111-4111-8111-111111111111',
            operator: 'equals',
            value: 'non'
          }
        ],
        action_type: 'end_form'
      },
      context({ supabase: client })
    );

    expect(result.ok).toBe(true);
  });

  it('refuse une règle sans aucune condition', async () => {
    // Elle se déclencherait toujours, ce que personne n'écrit volontairement.
    const result = await runTool(
      'add_logic_rule',
      { conditions: [], action_type: 'end_form' },
      context()
    );

    expect(result.ok).toBe(false);
  });
});

describe('delete_section', () => {
  it('refuse de supprimer la dernière section', async () => {
    // Sans section, aucune question ne peut plus être ajoutée : la contrainte
    // `section_id not null` la refuserait, et le constructeur ne construirait
    // plus rien.
    const { client } = fakeClient({ 'sections.select': { data: null, error: null, count: 1 } });

    const result = await runTool(
      'delete_section',
      { section_id: '11111111-1111-4111-8111-111111111111' },
      context({ supabase: client })
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('dernière section');
  });
});

describe('price_option', () => {
  it('refuse un prix posé sur une option qui n’existe pas', async () => {
    // C'est le cas type de l'identifiant inventé : sans ce contrôle, le prix
    // serait simplement perdu, et le total afficherait un montant trop bas sans
    // rien signaler.
    const { client } = fakeClient({
      'fields.select': { data: { options: [{ id: 'opt_a' }] }, error: null }
    });

    const result = await runTool(
      'price_option',
      {
        field_id: '11111111-1111-4111-8111-111111111111',
        prices: [{ option_id: 'opt_inexistante', price: 500 }]
      },
      context({ supabase: client })
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('opt_inexistante');
  });

  it('applique le prix à la bonne option et laisse les autres intactes', async () => {
    const { client, calls } = fakeClient({
      'fields.select': {
        data: { options: [{ id: 'opt_a', label: { fr: 'A' } }, { id: 'opt_b', label: { fr: 'B' } }] },
        error: null
      }
    });

    const result = await runTool(
      'price_option',
      {
        field_id: '11111111-1111-4111-8111-111111111111',
        prices: [{ option_id: 'opt_b', price: 1200 }]
      },
      context({ supabase: client })
    );

    expect(result.ok).toBe(true);

    const update = calls.find((call) => call.table === 'fields' && call.op === 'update');
    const options = (update?.payload as { options: { id: string; price?: number }[] }).options;

    expect(options.find((option) => option.id === 'opt_a')).not.toHaveProperty('price');
    expect(options.find((option) => option.id === 'opt_b')?.price).toBe(1200);
  });
});

describe('set_visibility', () => {
  it('rend une question toujours visible quand on retire ses conditions', async () => {
    const { client, calls } = fakeClient({
      'fields.select': { data: [{ id: '11111111-1111-4111-8111-111111111111' }], error: null },
      'fields.update': { data: null, error: null, count: 1 }
    });

    const result = await runTool(
      'set_visibility',
      { field_id: '11111111-1111-4111-8111-111111111111', conditions: [] },
      context({ supabase: client })
    );

    expect(result.ok).toBe(true);

    const update = calls.find((call) => call.table === 'fields' && call.op === 'update');
    // Un objet vide, et non `{enabled: false}` : c'est la forme que
    // `lib/visibility.ts` traite comme « aucun verrou », et deux formes pour
    // le même sens finiraient par diverger.
    expect((update?.payload as { visibility: object }).visibility).toEqual({});
  });
});

describe('les identifiants inventés', () => {
  it('refuse une règle de logique qui interroge une question fantôme', async () => {
    // Trouvé en éprouvant les outils contre la vraie base : la clé étrangère ne
    // protège que la CIBLE d'une règle. Les conditions vivent dans une colonne
    // `jsonb`, où PostgreSQL n'a rien à contrôler — la règle était acceptée, et
    // ne se serait jamais déclenchée.
    const { client } = fakeClient({ 'fields.select': { data: [], error: null } });

    const result = await runTool(
      'add_logic_rule',
      {
        conditions: [
          {
            source_field_id: '00000000-0000-4000-8000-000000000000',
            operator: 'equals',
            value: 'oui'
          }
        ],
        action_type: 'end_form'
      },
      context({ supabase: client })
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('00000000-0000-4000-8000-000000000000');
    expect(result.message).toContain('describe_form');
  });

  it('refuse une condition d’affichage qui interroge une question fantôme', async () => {
    const { client } = fakeClient({
      'fields.select': { data: [{ id: '11111111-1111-4111-8111-111111111111' }], error: null }
    });

    const result = await runTool(
      'set_visibility',
      {
        field_id: '11111111-1111-4111-8111-111111111111',
        conditions: [
          {
            source_field_id: '22222222-2222-4222-8222-222222222222',
            operator: 'equals',
            value: 'oui'
          }
        ]
      },
      context({ supabase: client })
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('22222222-2222-4222-8222-222222222222');
  });

  it('refuse qu’une question conditionne son propre affichage', async () => {
    // Elle ne serait jamais évaluable : l'affichage se figerait sur son état
    // par défaut, sans erreur nulle part.
    const id = '11111111-1111-4111-8111-111111111111';
    const { client } = fakeClient({ 'fields.select': { data: [{ id }], error: null } });

    const result = await runTool(
      'set_visibility',
      { field_id: id, conditions: [{ source_field_id: id, operator: 'equals', value: 'oui' }] },
      context({ supabase: client })
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('son propre affichage');
  });
});

describe('set_tiers', () => {
  it('refuse un tarif dégressif sans palier', async () => {
    const result = await runTool('set_tiers', { enabled: true, tiers: [] }, context());
    expect(result.ok).toBe(false);
  });
});

describe('publish_form', () => {
  it('refuse de publier un formulaire vide', async () => {
    // Publier n'aurait rien à montrer, et l'adresse publique circulerait déjà.
    const { client } = fakeClient({ 'fields.select': { data: null, error: null, count: 0 } });

    const result = await runTool('publish_form', { published: true }, context({ supabase: client }));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('aucune question');
  });
});

describe('l’ancrage de la conversation', () => {
  it('dit quoi faire plutôt que d’échouer quand rien n’est ouvert', async () => {
    // Le modèle peut alors créer un formulaire et réessayer, là où une erreur
    // de clé étrangère le laisserait boucler.
    const result = await runTool(
      'add_section',
      { title: 'Coordonnées' },
      context({ formId: null })
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('create_form');
  });

  it('déplace l’ancrage sur le formulaire qu’il vient de créer', async () => {
    const { client } = fakeClient({
      'forms.insert': { data: { id: 'form-neuf', title: 'Inscription' }, error: null },
      'sections.insert': { data: { id: 'sec-neuve' }, error: null }
    });

    const ctx = context({ supabase: client, formId: null });
    const result = await runTool('create_form', { title: 'Inscription' }, ctx);

    expect(result.ok).toBe(true);
    // Sans ce déplacement, il faudrait répéter l'identifiant à chaque appel —
    // et le modèle finirait par en inventer un.
    expect(ctx.formId).toBe('form-neuf');
  });
});
