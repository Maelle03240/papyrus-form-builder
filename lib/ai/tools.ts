import 'server-only';

import { z } from 'zod';

import type { createClient } from '@/lib/supabase/server';
import { DEFAULT_PROJECT_INVOICING, DEFAULT_PROJECT_MODULES, DEFAULT_PROJECT_PRICING } from '@/types';
import { uniqueSlug } from '@/lib/utils';
import { generatePartnerCode } from '@/lib/partners';

/**
 * La couche d'outils — ce que l'IA a le droit de faire.
 *
 * **Elle n'écrit jamais un schéma.** L'ancienne route `/api/generate-form`
 * demandait un objet JSON complet à un modèle et l'importait tel quel : un type
 * de champ inventé, un identifiant qui ne désigne rien, une règle logique qui
 * pointe dans le vide passaient sans que rien ne les arrête. Ici chaque geste
 * est une opération nommée, validée par Zod, et refusée si elle ne tient pas.
 *
 * **Les outils s'exécutent sous la session de l'utilisateur connecté**, donc
 * sous RLS. C'est la garantie qui compte : le modèle ne peut pas toucher une
 * donnée que la personne devant l'écran ne pourrait pas toucher elle-même. Un
 * `service_role` ici — plus simple à écrire — aurait signifié qu'une phrase mal
 * tournée pouvait atteindre le formulaire d'une autre équipe.
 *
 * **Les outils de lecture sont aussi importants que ceux d'écriture.** Sans
 * `describe_form`, le modèle ne connaît aucun identifiant de champ, et ne peut
 * donc écrire ni logique, ni tarification, ni condition d'affichage. Il
 * inventerait — c'est exactement ce qu'on cherche à supprimer.
 */

type SessionClient = ReturnType<typeof createClient>;

export interface ToolContext {
  supabase: SessionClient;
  teamId: string;
  userId: string;
  /**
   * L'ancrage courant de la conversation. Les outils qui créent un projet ou un
   * formulaire le déplacent : sans cela, il faudrait répéter l'identifiant à
   * chaque appel, et le modèle finirait par en inventer un.
   */
  projectId: string | null;
  formId: string | null;
}

export interface ToolResult {
  ok: boolean;
  /** Une phrase rendue au modèle. C'est sa seule vue du résultat. */
  message: string;
  data?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  /** Vrai si l'outil modifie le contenu d'un formulaire — déclenche l'instantané. */
  mutates: boolean;
  run: (input: never, ctx: ToolContext) => Promise<ToolResult>;
}

// ============================================================================
// Fragments partagés
// ============================================================================

/**
 * Un libellé multilingue.
 *
 * Accepté en chaîne simple ET en objet par langue : demander au modèle
 * `{"fr": "Nom"}` pour chaque libellé triple la taille de chaque appel et
 * multiplie les occasions de se tromper de forme. La normalisation se fait ici.
 */
const TextSchema = z.union([z.string(), z.record(z.string(), z.string())]);

function toMultilingual(value: unknown, language = 'fr'): Record<string, string> {
  if (typeof value === 'string') return { [language]: value };
  if (value && typeof value === 'object') return value as Record<string, string>;
  return {};
}

const FIELD_TYPES = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'url',
  'single_choice',
  'multiple_choice',
  'dropdown',
  'rating',
  'nps',
  'date',
  'file',
  'statement',
  'image',
  'video',
  'matrix',
  'currency',
  'address',
  'country',
  'yesno',
  'signature',
  'repeater',
  'calculated',
  'link',
  'hidden',
  'divider'
] as const;

const OptionSchema = z.object({
  label: z.string().describe('Libellé montré au répondant.'),
  value: z.string().optional().describe('Valeur enregistrée. Par défaut, le libellé.'),
  points: z.number().optional().describe('Points attribués si le formulaire est noté.'),
  price: z.number().optional().describe('Prix de cette option, dans la devise du projet.')
});

function toOptions(
  options: z.infer<typeof OptionSchema>[] | undefined
): { id: string; label: Record<string, string>; value?: string; points?: number; price?: number }[] {
  return (options ?? []).map((option, index) => ({
    id: `opt_${Date.now().toString(36)}_${index}`,
    label: { fr: option.label },
    ...(option.value ? { value: option.value } : {}),
    ...(option.points !== undefined ? { points: option.points } : {}),
    ...(option.price !== undefined ? { price: option.price } : {})
  }));
}

/** Erreur normalisée : le modèle reçoit une phrase, jamais une erreur Postgres. */
function fail(message: string): ToolResult {
  return { ok: false, message };
}

function ok(message: string, data?: unknown): ToolResult {
  return { ok: true, message, data };
}

/**
 * Le formulaire courant, ou l'explication de son absence.
 *
 * Renvoyer « aucun formulaire ouvert » plutôt que d'échouer sur une contrainte
 * de clé étrangère : le modèle peut alors en créer un et réessayer, là où une
 * erreur SQL le laisserait boucler.
 */
function requireForm(ctx: ToolContext): string | null {
  return ctx.formId;
}

const NO_FORM =
  'Aucun formulaire n’est ouvert. Créez-en un avec create_form, ou demandez lequel modifier.';
const NO_PROJECT =
  'Aucun projet n’est ouvert. Créez-en un avec create_project, ou demandez lequel utiliser.';

/**
 * Les questions désignées existent-elles VRAIMENT sur le formulaire ouvert ?
 *
 * Écrit après avoir vu le contraire passer en production d'essai : une règle de
 * logique dont la condition citait un identifiant inexistant a été acceptée
 * sans un mot. La clé étrangère ne protège que `target_field_id` ; les
 * conditions, elles, vivent dans une colonne `jsonb`, où PostgreSQL n'a rien à
 * contrôler.
 *
 * Une règle qui interroge une question fantôme ne se déclenche jamais. Elle ne
 * casse rien, ne journalise rien, et se découvre le jour où un répondant dit
 * qu'il n'a pas vu la question qu'on lui promettait.
 */
async function assertFieldsExist(
  ctx: ToolContext,
  formId: string,
  ids: string[]
): Promise<string[]> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return [];

  const { data } = await ctx.supabase
    .from('fields')
    .select('id')
    .eq('form_id', formId)
    .in('id', wanted);

  const found = new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
  return wanted.filter((id) => !found.has(id));
}

// ============================================================================
// Lecture
// ============================================================================

const describeProject: ToolDefinition = {
  name: 'describe_project',
  description:
    'Décrit le projet courant : nom, modules activés, devise, TVA, et la liste de ses formulaires avec leur identifiant et leur état.',
  schema: z.object({}),
  mutates: false,
  async run(_input, ctx) {
    if (!ctx.projectId) return fail(NO_PROJECT);

    const [{ data: project }, { data: forms }] = await Promise.all([
      ctx.supabase.from('projects').select('*').eq('id', ctx.projectId).maybeSingle(),
      ctx.supabase
        .from('forms')
        .select('id, title, status, slug')
        .eq('project_id', ctx.projectId)
        .eq('is_template', false)
    ]);

    if (!project) return fail('Ce projet est introuvable.');

    return ok('Projet décrit.', {
      id: project.id,
      name: project.name,
      description: project.description,
      modules: project.modules,
      pricing: project.pricing,
      languages: project.languages,
      forms: forms ?? []
    });
  }
};

const describeForm: ToolDefinition = {
  name: 'describe_form',
  description:
    'Décrit le formulaire courant : ses sections, ses questions avec leur identifiant, leur type et leurs options, et ses règles de logique. À appeler AVANT toute modification qui référence une question existante.',
  schema: z.object({}),
  mutates: false,
  async run(_input, ctx) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const { data: form } = await ctx.supabase
      .from('forms')
      .select('*, sections(*), fields(*), logic_rules(*)')
      .eq('id', formId)
      .maybeSingle();

    if (!form) return fail('Ce formulaire est introuvable.');

    const sections = (form.sections ?? []) as { id: string; title: unknown; section_order: number }[];
    const fields = (form.fields ?? []) as {
      id: string;
      section_id: string;
      type: string;
      label: unknown;
      required: boolean;
      field_order: number;
      options: unknown;
    }[];

    return ok('Formulaire décrit.', {
      id: form.id,
      title: form.title,
      status: form.status,
      pricing_config: form.pricing_config,
      sections: sections
        .sort((a, b) => a.section_order - b.section_order)
        .map((section) => ({
          id: section.id,
          title: section.title,
          fields: fields
            .filter((field) => field.section_id === section.id)
            .sort((a, b) => a.field_order - b.field_order)
            .map((field) => ({
              id: field.id,
              type: field.type,
              label: field.label,
              required: field.required,
              options: field.options
            }))
        })),
      logic_rules: form.logic_rules ?? []
    });
  }
};

// ============================================================================
// Projet
// ============================================================================

const createProject: ToolDefinition = {
  name: 'create_project',
  description:
    'Crée un projet et le rend courant. Un projet regroupe des formulaires et porte ce qui leur est commun : marque, langues, devise, modules.',
  schema: z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    modules: z
      .object({
        pricing: z.boolean().optional(),
        partners: z.boolean().optional(),
        invoicing: z.boolean().optional(),
        email: z.boolean().optional()
      })
      .optional()
      .describe('Modules à activer. Tout est éteint par défaut.')
  }),
  mutates: false,
  async run(input: { name: string; description?: string; modules?: Record<string, boolean> }, ctx) {
    const { data, error } = await ctx.supabase
      .from('projects')
      .insert({
        team_id: ctx.teamId,
        created_by: ctx.userId,
        name: input.name,
        description: input.description ?? '',
        modules: { ...DEFAULT_PROJECT_MODULES, ...(input.modules ?? {}) },
        pricing: DEFAULT_PROJECT_PRICING,
        invoice_prefix: DEFAULT_PROJECT_INVOICING.prefix,
        invoice_next: DEFAULT_PROJECT_INVOICING.next,
        invoice_pad: DEFAULT_PROJECT_INVOICING.pad
      })
      .select('id, name')
      .single();

    if (error) return fail('Le projet n’a pas pu être créé.');

    ctx.projectId = data.id;
    ctx.formId = null;

    return ok(`Projet « ${data.name} » créé et ouvert.`, { project_id: data.id });
  }
};

const setProjectModules: ToolDefinition = {
  name: 'set_project_modules',
  description:
    'Active ou désactive les modules du projet courant : tarification, partenaires, facturation, e-mails.',
  schema: z.object({
    pricing: z.boolean().optional(),
    partners: z.boolean().optional(),
    invoicing: z.boolean().optional(),
    email: z.boolean().optional()
  }),
  mutates: false,
  async run(input: Record<string, boolean | undefined>, ctx) {
    if (!ctx.projectId) return fail(NO_PROJECT);

    const { data: current } = await ctx.supabase
      .from('projects')
      .select('modules')
      .eq('id', ctx.projectId)
      .maybeSingle();

    const modules = { ...DEFAULT_PROJECT_MODULES, ...(current?.modules ?? {}) };
    for (const key of ['pricing', 'partners', 'invoicing', 'email'] as const) {
      if (input[key] !== undefined) modules[key] = input[key] as boolean;
    }

    const { error } = await ctx.supabase
      .from('projects')
      .update({ modules })
      .eq('id', ctx.projectId);

    if (error) return fail('Les modules n’ont pas pu être enregistrés.');

    const on = Object.entries(modules)
      .filter(([, value]) => value)
      .map(([key]) => key);

    return ok(on.length > 0 ? `Modules actifs : ${on.join(', ')}.` : 'Tous les modules sont éteints.');
  }
};

const setBranding: ToolDefinition = {
  name: 'set_branding',
  description:
    'Règle la marque du projet courant : couleur d’accent, langues proposées et langue par défaut.',
  schema: z.object({
    accent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional()
      .describe('Couleur d’accent en hexadécimal, par exemple #2AC2DE.'),
    languages: z.array(z.string().min(2).max(5)).min(1).optional(),
    default_language: z.string().min(2).max(5).optional()
  }),
  mutates: false,
  async run(
    input: { accent?: string; languages?: string[]; default_language?: string },
    ctx
  ) {
    if (!ctx.projectId) return fail(NO_PROJECT);

    const { data: current } = await ctx.supabase
      .from('projects')
      .select('theme, languages')
      .eq('id', ctx.projectId)
      .maybeSingle();

    const patch: Record<string, unknown> = {};
    if (input.accent) {
      patch.theme = { ...((current?.theme as object) ?? {}), accent: input.accent };
    }
    if (input.languages) patch.languages = input.languages;
    if (input.default_language) {
      // La langue par défaut doit figurer dans la liste, sinon le formulaire
      // s'ouvre dans une langue qu'il ne propose pas.
      const languages = input.languages ?? (current?.languages as string[]) ?? ['fr'];
      if (!languages.includes(input.default_language)) {
        return fail(
          `La langue « ${input.default_language} » ne figure pas dans les langues du projet. Ajoutez-la d’abord avec le paramètre languages.`
        );
      }
      patch.default_language = input.default_language;
    }

    if (Object.keys(patch).length === 0) return ok('Rien à changer.');

    const { error } = await ctx.supabase.from('projects').update(patch).eq('id', ctx.projectId);
    if (error) return fail('La marque n’a pas pu être enregistrée.');

    return ok('Marque du projet mise à jour.');
  }
};

// ============================================================================
// Formulaire
// ============================================================================

const createForm: ToolDefinition = {
  name: 'create_form',
  description:
    'Crée un formulaire dans le projet courant et le rend courant. Il naît avec une première section vide, prête à recevoir des questions.',
  schema: z.object({
    title: z.string().min(1).max(150),
    description: z.string().max(500).optional()
  }),
  mutates: false,
  async run(input: { title: string; description?: string }, ctx) {
    if (!ctx.projectId) return fail(NO_PROJECT);

    const { data: form, error } = await ctx.supabase
      .from('forms')
      .insert({
        team_id: ctx.teamId,
        project_id: ctx.projectId,
        created_by: ctx.userId,
        title: input.title,
        description: input.description ?? '',
        slug: uniqueSlug(input.title),
        status: 'draft'
      })
      .select('id, title')
      .single();

    if (error) return fail('Le formulaire n’a pas pu être créé.');

    // Tout champ appartient à une section depuis la migration 004 : en créer
    // une tout de suite évite que le premier `add_field` échoue sur une
    // contrainte que le modèle ne peut pas deviner.
    const { data: section } = await ctx.supabase
      .from('sections')
      .insert({ form_id: form.id, title: {}, section_order: 0 })
      .select('id')
      .single();

    ctx.formId = form.id;

    return ok(`Formulaire « ${form.title} » créé et ouvert.`, {
      form_id: form.id,
      section_id: section?.id ?? null
    });
  }
};

const renameForm: ToolDefinition = {
  name: 'rename_form',
  description: 'Change le titre ou la description du formulaire courant.',
  schema: z.object({
    title: z.string().min(1).max(150).optional(),
    description: z.string().max(500).optional()
  }),
  mutates: true,
  async run(input: { title?: string; description?: string }, ctx) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (Object.keys(patch).length === 0) return ok('Rien à changer.');

    const { error } = await ctx.supabase.from('forms').update(patch).eq('id', formId);
    if (error) return fail('Le formulaire n’a pas pu être renommé.');

    return ok('Formulaire mis à jour.');
  }
};

const openForm: ToolDefinition = {
  name: 'open_form',
  description:
    'Rend courant un autre formulaire du projet, désigné par son identifiant. Utiliser describe_project pour connaître les identifiants.',
  schema: z.object({ form_id: z.string().uuid() }),
  mutates: false,
  async run(input: { form_id: string }, ctx) {
    const { data } = await ctx.supabase
      .from('forms')
      .select('id, title, project_id')
      .eq('id', input.form_id)
      .maybeSingle();

    if (!data) return fail('Ce formulaire est introuvable, ou hors de votre espace de travail.');

    ctx.formId = data.id;
    ctx.projectId = data.project_id ?? ctx.projectId;

    return ok(`Formulaire « ${data.title} » ouvert.`);
  }
};

// ============================================================================
// Structure
// ============================================================================

const addSection: ToolDefinition = {
  name: 'add_section',
  description:
    'Ajoute une section à la fin du formulaire courant. Une section regroupe des questions sous un même titre.',
  schema: z.object({
    title: TextSchema.describe('Titre de la section.'),
    description: TextSchema.optional()
  }),
  mutates: true,
  async run(input: { title: unknown; description?: unknown }, ctx) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const { data: last } = await ctx.supabase
      .from('sections')
      .select('section_order')
      .eq('form_id', formId)
      .order('section_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await ctx.supabase
      .from('sections')
      .insert({
        form_id: formId,
        title: toMultilingual(input.title),
        description: toMultilingual(input.description),
        section_order: (last?.section_order ?? -1) + 1
      })
      .select('id')
      .single();

    if (error) return fail('La section n’a pas pu être créée.');

    return ok('Section ajoutée.', { section_id: data.id });
  }
};

const updateSection: ToolDefinition = {
  name: 'update_section',
  description: 'Change le titre ou la description d’une section existante.',
  schema: z.object({
    section_id: z.string().uuid(),
    title: TextSchema.optional(),
    description: TextSchema.optional()
  }),
  mutates: true,
  async run(input: { section_id: string; title?: unknown; description?: unknown }, ctx) {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = toMultilingual(input.title);
    if (input.description !== undefined) patch.description = toMultilingual(input.description);
    if (Object.keys(patch).length === 0) return ok('Rien à changer.');

    const { error, count } = await ctx.supabase
      .from('sections')
      .update(patch, { count: 'exact' })
      .eq('id', input.section_id);

    if (error) return fail('La section n’a pas pu être modifiée.');
    if (count === 0) return fail('Cette section est introuvable.');

    return ok('Section mise à jour.');
  }
};

const moveSection: ToolDefinition = {
  name: 'move_section',
  description: 'Déplace une section à une position donnée (0 = première).',
  schema: z.object({ section_id: z.string().uuid(), position: z.number().int().min(0) }),
  mutates: true,
  async run(input: { section_id: string; position: number }, ctx) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const { data: sections } = await ctx.supabase
      .from('sections')
      .select('id, section_order')
      .eq('form_id', formId)
      .order('section_order', { ascending: true });

    const list = (sections ?? []) as { id: string; section_order: number }[];
    const from = list.findIndex((section) => section.id === input.section_id);
    if (from < 0) return fail('Cette section n’appartient pas au formulaire ouvert.');

    const [moved] = list.splice(from, 1);
    list.splice(Math.min(input.position, list.length), 0, moved);

    // Réécriture complète des rangs plutôt qu'un échange de deux lignes : sur
    // une liste réordonnée à la main, deux sections finissent tôt ou tard avec
    // le même rang, et l'ordre affiché devient celui du hasard.
    for (const [index, section] of list.entries()) {
      await ctx.supabase.from('sections').update({ section_order: index }).eq('id', section.id);
    }

    return ok('Section déplacée.');
  }
};

const deleteSection: ToolDefinition = {
  name: 'delete_section',
  description:
    'Supprime une section ET toutes ses questions. Irréversible : demander confirmation avant.',
  schema: z.object({ section_id: z.string().uuid() }),
  mutates: true,
  async run(input: { section_id: string }, ctx) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const { count } = await ctx.supabase
      .from('sections')
      .select('id', { count: 'exact', head: true })
      .eq('form_id', formId);

    // Un formulaire sans section ne peut plus recevoir de question : la
    // contrainte `section_id not null` la refuserait, et l'auteur se
    // retrouverait devant un constructeur qui ne construit plus rien.
    if ((count ?? 0) <= 1) {
      return fail(
        'C’est la dernière section du formulaire : la supprimer le rendrait inutilisable. Videz-la plutôt de ses questions.'
      );
    }

    const { error } = await ctx.supabase.from('sections').delete().eq('id', input.section_id);
    if (error) return fail('La section n’a pas pu être supprimée.');

    return ok('Section supprimée, avec ses questions.');
  }
};

// ============================================================================
// Champs
// ============================================================================

const addField: ToolDefinition = {
  name: 'add_field',
  description:
    'Ajoute une question à la fin d’une section. Pour les types à choix (single_choice, multiple_choice, dropdown), fournir options.',
  schema: z.object({
    section_id: z.string().uuid().optional().describe('Par défaut, la dernière section.'),
    type: z.enum(FIELD_TYPES),
    label: TextSchema,
    description: TextSchema.optional(),
    placeholder: TextSchema.optional(),
    required: z.boolean().optional(),
    options: z.array(OptionSchema).optional()
  }),
  mutates: true,
  async run(
    input: {
      section_id?: string;
      type: (typeof FIELD_TYPES)[number];
      label: unknown;
      description?: unknown;
      placeholder?: unknown;
      required?: boolean;
      options?: z.infer<typeof OptionSchema>[];
    },
    ctx
  ) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    let sectionId = input.section_id;
    if (!sectionId) {
      const { data: last } = await ctx.supabase
        .from('sections')
        .select('id')
        .eq('form_id', formId)
        .order('section_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      sectionId = last?.id;
    }

    if (!sectionId) return fail('Ce formulaire n’a aucune section. Ajoutez-en une avec add_section.');

    const needsOptions = ['single_choice', 'multiple_choice', 'dropdown'].includes(input.type);
    if (needsOptions && (input.options ?? []).length === 0) {
      // Refusé plutôt qu'écrit vide : une question à choix sans choix s'affiche
      // au répondant comme un bloc muet, et le défaut ne se voit qu'en ouvrant
      // le formulaire public.
      return fail(
        `Une question de type ${input.type} a besoin d’au moins une option. Rappelez add_field avec options.`
      );
    }

    const { data: last } = await ctx.supabase
      .from('fields')
      .select('field_order')
      .eq('form_id', formId)
      .eq('section_id', sectionId)
      .order('field_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await ctx.supabase
      .from('fields')
      .insert({
        form_id: formId,
        section_id: sectionId,
        type: input.type,
        label: toMultilingual(input.label),
        description: toMultilingual(input.description),
        placeholder: toMultilingual(input.placeholder),
        required: input.required ?? false,
        options: toOptions(input.options),
        field_order: (last?.field_order ?? -1) + 1
      })
      .select('id')
      .single();

    if (error) return fail('La question n’a pas pu être ajoutée.');

    return ok('Question ajoutée.', { field_id: data.id });
  }
};

const updateField: ToolDefinition = {
  name: 'update_field',
  description: 'Change le libellé, l’aide, l’invite ou le caractère obligatoire d’une question.',
  schema: z.object({
    field_id: z.string().uuid(),
    label: TextSchema.optional(),
    description: TextSchema.optional(),
    placeholder: TextSchema.optional(),
    required: z.boolean().optional()
  }),
  mutates: true,
  async run(
    input: {
      field_id: string;
      label?: unknown;
      description?: unknown;
      placeholder?: unknown;
      required?: boolean;
    },
    ctx
  ) {
    const patch: Record<string, unknown> = {};
    if (input.label !== undefined) patch.label = toMultilingual(input.label);
    if (input.description !== undefined) patch.description = toMultilingual(input.description);
    if (input.placeholder !== undefined) patch.placeholder = toMultilingual(input.placeholder);
    if (input.required !== undefined) patch.required = input.required;
    if (Object.keys(patch).length === 0) return ok('Rien à changer.');

    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    // Filtré sur le formulaire ouvert, et pas seulement sur l'identifiant : la
    // RLS s'arrête à l'espace de travail, et rien d'autre n'empêcherait de
    // modifier au passage la question d'un formulaire voisin.
    const { error, count } = await ctx.supabase
      .from('fields')
      .update(patch, { count: 'exact' })
      .eq('id', input.field_id)
      .eq('form_id', formId);

    if (error) return fail('La question n’a pas pu être modifiée.');
    if (count === 0) return fail('Cette question est introuvable sur ce formulaire.');

    return ok('Question mise à jour.');
  }
};

const setOptions: ToolDefinition = {
  name: 'set_options',
  description:
    'Remplace la liste d’options d’une question à choix. Les options existantes sont écrasées — inclure toutes celles à conserver.',
  schema: z.object({
    field_id: z.string().uuid(),
    options: z.array(OptionSchema).min(1)
  }),
  mutates: true,
  async run(input: { field_id: string; options: z.infer<typeof OptionSchema>[] }, ctx) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const { error, count } = await ctx.supabase
      .from('fields')
      .update({ options: toOptions(input.options) }, { count: 'exact' })
      .eq('id', input.field_id)
      .eq('form_id', formId);

    if (error) return fail('Les options n’ont pas pu être enregistrées.');
    if (count === 0) return fail('Cette question est introuvable sur ce formulaire.');

    return ok(`${input.options.length} option(s) enregistrée(s).`);
  }
};

const setValidation: ToolDefinition = {
  name: 'set_validation',
  description:
    'Règle les contraintes de saisie d’une question : longueur, bornes numériques, nombre de choix.',
  schema: z.object({
    field_id: z.string().uuid(),
    min_length: z.number().int().min(0).optional(),
    max_length: z.number().int().min(1).optional(),
    min_value: z.number().optional(),
    max_value: z.number().optional(),
    min_selections: z.number().int().min(0).optional(),
    max_selections: z.number().int().min(1).optional()
  }),
  mutates: true,
  async run(input: Record<string, unknown> & { field_id: string }, ctx) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const { data: field } = await ctx.supabase
      .from('fields')
      .select('validation')
      .eq('id', input.field_id)
      .eq('form_id', formId)
      .maybeSingle();

    if (!field) return fail('Cette question est introuvable sur ce formulaire.');

    const validation = { ...((field.validation as object) ?? {}) } as Record<string, unknown>;
    for (const key of [
      'min_length',
      'max_length',
      'min_value',
      'max_value',
      'min_selections',
      'max_selections'
    ]) {
      if (input[key] !== undefined) validation[key] = input[key];
    }

    const { error } = await ctx.supabase
      .from('fields')
      .update({ validation })
      .eq('id', input.field_id);

    if (error) return fail('Les contraintes n’ont pas pu être enregistrées.');

    return ok('Contraintes de saisie enregistrées.');
  }
};

const setVisibility: ToolDefinition = {
  name: 'set_visibility',
  description:
    'Conditionne l’affichage d’une question aux réponses données plus haut. Sans conditions, la question redevient toujours visible.',
  schema: z.object({
    field_id: z.string().uuid(),
    operator: z.enum(['AND', 'OR']).optional().describe('Comment combiner les conditions. AND par défaut.'),
    conditions: z
      .array(
        z.object({
          source_field_id: z.string().uuid().describe('La question dont dépend l’affichage.'),
          operator: z.enum([
            'equals',
            'not_equals',
            'contains',
            'not_contains',
            'is_empty',
            'is_not_empty',
            'greater_than',
            'less_than'
          ]),
          value: z.string().optional().describe('Pour une question à choix, l’identifiant de l’option.')
        })
      )
      .describe('Liste vide = la question redevient toujours visible.')
  }),
  mutates: true,
  async run(
    input: {
      field_id: string;
      operator?: 'AND' | 'OR';
      conditions: { source_field_id: string; operator: string; value?: string }[];
    },
    ctx
  ) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const missing = await assertFieldsExist(ctx, formId, [
      input.field_id,
      ...input.conditions.map((condition) => condition.source_field_id)
    ]);

    if (missing.length > 0) {
      return fail(
        `Ces questions n’existent pas sur ce formulaire : ${missing.join(', ')}. Appelez describe_form pour connaître les identifiants.`
      );
    }

    // Une question ne peut pas dépendre d'elle-même : la condition ne serait
    // jamais évaluable, et l'affichage se figerait sur son état par défaut.
    if (input.conditions.some((condition) => condition.source_field_id === input.field_id)) {
      return fail('Une question ne peut pas conditionner son propre affichage.');
    }

    const visibility =
      input.conditions.length === 0
        ? {}
        : {
            enabled: true,
            operator: input.operator ?? 'AND',
            conditions: input.conditions.map((condition) => ({
              source_field_id: condition.source_field_id,
              operator: condition.operator,
              value: condition.value ?? ''
            }))
          };

    const { error, count } = await ctx.supabase
      .from('fields')
      .update({ visibility }, { count: 'exact' })
      .eq('id', input.field_id)
      .eq('form_id', formId);

    if (error) return fail('La condition d’affichage n’a pas pu être enregistrée.');
    if (count === 0) return fail('Cette question est introuvable.');

    return ok(
      input.conditions.length === 0
        ? 'Question rendue toujours visible.'
        : 'Condition d’affichage enregistrée.'
    );
  }
};

const moveField: ToolDefinition = {
  name: 'move_field',
  description:
    'Déplace une question : dans une autre section, ou à une autre position au sein de la sienne.',
  schema: z.object({
    field_id: z.string().uuid(),
    section_id: z.string().uuid().optional().describe('Section d’arrivée. Par défaut, la sienne.'),
    position: z.number().int().min(0).optional().describe('0 = première de la section.')
  }),
  mutates: true,
  async run(input: { field_id: string; section_id?: string; position?: number }, ctx) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const { data: field } = await ctx.supabase
      .from('fields')
      .select('id, section_id, form_id')
      .eq('id', input.field_id)
      .maybeSingle();

    if (!field || field.form_id !== formId) {
      return fail('Cette question n’appartient pas au formulaire ouvert.');
    }

    const targetSection = input.section_id ?? field.section_id;

    const { data: siblings } = await ctx.supabase
      .from('fields')
      .select('id, field_order')
      .eq('form_id', formId)
      .eq('section_id', targetSection)
      .order('field_order', { ascending: true });

    const list = ((siblings ?? []) as { id: string }[]).filter((row) => row.id !== input.field_id);
    list.splice(Math.min(input.position ?? list.length, list.length), 0, { id: input.field_id });

    await ctx.supabase
      .from('fields')
      .update({ section_id: targetSection })
      .eq('id', input.field_id);

    for (const [index, row] of list.entries()) {
      await ctx.supabase.from('fields').update({ field_order: index }).eq('id', row.id);
    }

    return ok('Question déplacée.');
  }
};

const deleteField: ToolDefinition = {
  name: 'delete_field',
  description: 'Supprime une question. Irréversible : demander confirmation avant.',
  schema: z.object({ field_id: z.string().uuid() }),
  mutates: true,
  async run(input: { field_id: string }, ctx) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const { error, count } = await ctx.supabase
      .from('fields')
      .delete({ count: 'exact' })
      .eq('id', input.field_id)
      .eq('form_id', formId);

    if (error) return fail('La question n’a pas pu être supprimée.');
    if (count === 0) return fail('Cette question est introuvable sur ce formulaire.');

    return ok('Question supprimée.');
  }
};

// ============================================================================
// Logique
// ============================================================================

const addLogicRule: ToolDefinition = {
  name: 'add_logic_rule',
  description:
    'Ajoute une règle de logique : selon les réponses, afficher, masquer, sauter à une question, ou terminer le formulaire.',
  schema: z.object({
    conditions: z
      .array(
        z.object({
          source_field_id: z.string().uuid(),
          operator: z.enum([
            'equals',
            'not_equals',
            'contains',
            'greater_than',
            'less_than',
            'is_empty',
            'is_not_empty'
          ]),
          value: z.string().optional()
        })
      )
      .min(1),
    conditions_operator: z.enum(['AND', 'OR']).optional(),
    action_type: z.enum(['show_field', 'hide_field', 'jump_to', 'end_form']),
    target_field_id: z
      .string()
      .uuid()
      .optional()
      .describe('Obligatoire sauf pour end_form.')
  }),
  mutates: true,
  async run(
    input: {
      conditions: { source_field_id: string; operator: string; value?: string }[];
      conditions_operator?: 'AND' | 'OR';
      action_type: string;
      target_field_id?: string;
    },
    ctx
  ) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    if (input.action_type !== 'end_form' && !input.target_field_id) {
      return fail(`L’action ${input.action_type} a besoin d’une question cible (target_field_id).`);
    }

    const missing = await assertFieldsExist(ctx, formId, [
      ...input.conditions.map((condition) => condition.source_field_id),
      ...(input.target_field_id ? [input.target_field_id] : [])
    ]);

    if (missing.length > 0) {
      return fail(
        `Ces questions n’existent pas sur ce formulaire : ${missing.join(', ')}. Appelez describe_form pour connaître les identifiants.`
      );
    }

    const { data: last } = await ctx.supabase
      .from('logic_rules')
      .select('rule_order')
      .eq('form_id', formId)
      .order('rule_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await ctx.supabase
      .from('logic_rules')
      .insert({
        form_id: formId,
        conditions: input.conditions.map((condition) => ({
          source_field_id: condition.source_field_id,
          operator: condition.operator,
          value: condition.value ?? ''
        })),
        conditions_operator: input.conditions_operator ?? 'AND',
        action_type: input.action_type,
        target_field_id: input.target_field_id ?? null,
        rule_order: (last?.rule_order ?? -1) + 1
      })
      .select('id')
      .single();

    if (error) {
      // Le cas courant : un identifiant de question qui n'existe pas, refusé par
      // la clé étrangère. Le dire précisément permet au modèle d'appeler
      // describe_form et de recommencer.
      return fail(
        'La règle n’a pas pu être créée. Vérifiez que les identifiants de questions existent (describe_form).'
      );
    }

    return ok('Règle de logique ajoutée.', { rule_id: data.id });
  }
};

const deleteLogicRule: ToolDefinition = {
  name: 'delete_logic_rule',
  description: 'Supprime une règle de logique.',
  schema: z.object({ rule_id: z.string().uuid() }),
  mutates: true,
  async run(input: { rule_id: string }, ctx) {
    const { error, count } = await ctx.supabase
      .from('logic_rules')
      .delete({ count: 'exact' })
      .eq('id', input.rule_id);

    if (error) return fail('La règle n’a pas pu être supprimée.');
    if (count === 0) return fail('Cette règle est introuvable.');

    return ok('Règle supprimée.');
  }
};

// ============================================================================
// Tarification
// ============================================================================

async function patchPricingConfig(
  ctx: ToolContext,
  formId: string,
  patch: Record<string, unknown>
): Promise<ToolResult> {
  const { data: form } = await ctx.supabase
    .from('forms')
    .select('pricing_config')
    .eq('id', formId)
    .maybeSingle();

  if (!form) return fail('Ce formulaire est introuvable.');

  const config = { ...((form.pricing_config as object) ?? {}), ...patch };

  const { error } = await ctx.supabase
    .from('forms')
    .update({ pricing_config: config })
    .eq('id', formId);

  if (error) return fail('La tarification n’a pas pu être enregistrée.');

  return ok('Tarification mise à jour.');
}

const enablePricing: ToolDefinition = {
  name: 'enable_pricing',
  description:
    'Active ou désactive la tarification du formulaire courant. Sans elle, aucun prix n’est calculé ni affiché.',
  schema: z.object({ enabled: z.boolean() }),
  mutates: true,
  async run(input: { enabled: boolean }, ctx) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);
    return patchPricingConfig(ctx, formId, { enabled: input.enabled });
  }
};

const setCurrencyVat: ToolDefinition = {
  name: 'set_currency_vat',
  description:
    'Règle la devise et la TVA du PROJET — donc de tous ses formulaires. La devise s’écrit telle qu’elle doit s’afficher : MUR, Rs., €.',
  schema: z.object({
    currency: z.string().min(1).max(10).optional(),
    currency_position: z.enum(['before', 'after']).optional(),
    vat_enabled: z.boolean().optional(),
    vat_rate: z.number().min(0).max(100).optional()
  }),
  mutates: false,
  async run(
    input: {
      currency?: string;
      currency_position?: 'before' | 'after';
      vat_enabled?: boolean;
      vat_rate?: number;
    },
    ctx
  ) {
    if (!ctx.projectId) return fail(NO_PROJECT);

    const { data: project } = await ctx.supabase
      .from('projects')
      .select('pricing')
      .eq('id', ctx.projectId)
      .maybeSingle();

    const pricing = { ...DEFAULT_PROJECT_PRICING, ...((project?.pricing as object) ?? {}), ...input };

    const { error } = await ctx.supabase
      .from('projects')
      .update({ pricing })
      .eq('id', ctx.projectId);

    if (error) return fail('La devise n’a pas pu être enregistrée.');

    return ok('Devise et TVA du projet mises à jour.');
  }
};

const priceOption: ToolDefinition = {
  name: 'price_option',
  description:
    'Donne un prix aux options d’une question à choix. Le prix vit sur l’option : la renommer ou la déplacer emporte son prix.',
  schema: z.object({
    field_id: z.string().uuid(),
    prices: z
      .array(
        z.object({
          option_id: z.string().describe('Identifiant de l’option, donné par describe_form.'),
          price: z.number()
        })
      )
      .min(1)
  }),
  mutates: true,
  async run(input: { field_id: string; prices: { option_id: string; price: number }[] }, ctx) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const { data: field } = await ctx.supabase
      .from('fields')
      .select('options')
      .eq('id', input.field_id)
      .eq('form_id', formId)
      .maybeSingle();

    if (!field) return fail('Cette question est introuvable sur ce formulaire.');

    const byId = new Map(input.prices.map((entry) => [entry.option_id, entry.price]));
    const options = ((field.options as { id: string }[]) ?? []).map((option) =>
      byId.has(option.id) ? { ...option, price: byId.get(option.id) } : option
    );

    const unknown = input.prices.filter(
      (entry) => !((field.options as { id: string }[]) ?? []).some((o) => o.id === entry.option_id)
    );

    if (unknown.length > 0) {
      return fail(
        `Ces options n’existent pas sur cette question : ${unknown
          .map((entry) => entry.option_id)
          .join(', ')}. Appelez describe_form pour connaître les identifiants.`
      );
    }

    const { error } = await ctx.supabase
      .from('fields')
      .update({ options, pricing: { count_in_total: true } })
      .eq('id', input.field_id)
      .eq('form_id', formId);

    if (error) return fail('Les prix n’ont pas pu être enregistrés.');

    return ok(`${input.prices.length} prix enregistré(s).`);
  }
};

const addDiscountCode: ToolDefinition = {
  name: 'add_discount_code',
  description: 'Ajoute un code de réduction au formulaire courant, en pourcentage ou en montant fixe.',
  schema: z.object({
    code: z.string().min(1).max(40),
    kind: z.enum(['percent', 'amount']),
    value: z.number().positive(),
    label: z.string().max(80).optional()
  }),
  mutates: true,
  async run(
    input: { code: string; kind: 'percent' | 'amount'; value: number; label?: string },
    ctx
  ) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const { data: form } = await ctx.supabase
      .from('forms')
      .select('pricing_config')
      .eq('id', formId)
      .maybeSingle();

    const config = { ...((form?.pricing_config as Record<string, unknown>) ?? {}) };
    const discounts = [...((config.discounts as unknown[]) ?? [])];

    discounts.push({
      code: input.code.trim().toUpperCase(),
      kind: input.kind,
      value: input.value,
      label: input.label ?? ''
    });

    const { error } = await ctx.supabase
      .from('forms')
      .update({ pricing_config: { ...config, discount_enabled: true, discounts } })
      .eq('id', formId);

    if (error) return fail('Le code de réduction n’a pas pu être enregistré.');

    return ok(`Code « ${input.code.toUpperCase()} » ajouté.`);
  }
};

const setTiers: ToolDefinition = {
  name: 'set_tiers',
  description:
    'Règle un tarif dégressif par paliers : le prix par inscription baisse à mesure que les places se remplissent.',
  schema: z.object({
    enabled: z.boolean(),
    label: z.string().max(80).optional(),
    tiers: z
      .array(
        z.object({
          up_to: z.number().int().positive().describe('Nombre d’inscriptions couvertes par ce palier.'),
          unit_price: z.number().min(0),
          label: z.string().max(80).optional()
        })
      )
      .optional()
  }),
  mutates: true,
  async run(
    input: {
      enabled: boolean;
      label?: string;
      tiers?: { up_to: number; unit_price: number; label?: string }[];
    },
    ctx
  ) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    if (input.enabled && (input.tiers ?? []).length === 0) {
      return fail('Un tarif dégressif a besoin d’au moins un palier.');
    }

    return patchPricingConfig(ctx, formId, {
      tiered: {
        enabled: input.enabled,
        label: input.label ?? '',
        tiers: (input.tiers ?? []).map((tier, index) => ({
          id: `tier_${index}`,
          up_to: tier.up_to,
          unit_price: tier.unit_price,
          label: tier.label ?? ''
        }))
      }
    });
  }
};

// ============================================================================
// E-mails
// ============================================================================

const setEmailDefault: ToolDefinition = {
  name: 'set_email_default',
  description:
    'Règle l’e-mail de confirmation envoyé au répondant : objet et message par défaut. Le message accepte des jetons {{identifiant_de_question}}.',
  schema: z.object({
    enabled: z.boolean().optional(),
    subject: z.string().max(200).optional(),
    message: z.string().max(4000).optional(),
    reply_to: z.string().email().optional()
  }),
  mutates: true,
  async run(
    input: { enabled?: boolean; subject?: string; message?: string; reply_to?: string },
    ctx
  ) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const { data: form } = await ctx.supabase
      .from('forms')
      .select('email_config')
      .eq('id', formId)
      .maybeSingle();

    if (!form) return fail('Ce formulaire est introuvable.');

    const config = { ...((form.email_config as Record<string, unknown>) ?? {}) };
    if (input.enabled !== undefined) config.enabled = input.enabled;
    if (input.reply_to !== undefined) config.reply_to = input.reply_to;

    const message = { ...((config.default_message as Record<string, unknown>) ?? {}) };
    if (input.subject !== undefined) message.subject = { fr: input.subject };
    if (input.message !== undefined) message.body = { fr: input.message };
    config.default_message = message;

    const { error } = await ctx.supabase
      .from('forms')
      .update({ email_config: config })
      .eq('id', formId);

    if (error) return fail('L’e-mail n’a pas pu être enregistré.');

    return ok('E-mail de confirmation mis à jour.');
  }
};

const addEmailRule: ToolDefinition = {
  name: 'add_email_rule',
  description:
    'Ajoute un message conditionnel : selon les réponses, le répondant reçoit ce texte plutôt que le message par défaut.',
  schema: z.object({
    subject: z.string().max(200),
    message: z.string().max(4000),
    conditions: z
      .array(
        z.object({
          source_field_id: z.string().uuid(),
          operator: z.enum(['equals', 'not_equals', 'contains', 'is_empty', 'is_not_empty']),
          value: z.string().optional()
        })
      )
      .min(1)
      .describe('Une règle sans condition ne se déclencherait jamais : elle est refusée.'),
    conditions_operator: z.enum(['AND', 'OR']).optional()
  }),
  mutates: true,
  async run(
    input: {
      subject: string;
      message: string;
      conditions: { source_field_id: string; operator: string; value?: string }[];
      conditions_operator?: 'AND' | 'OR';
    },
    ctx
  ) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const missing = await assertFieldsExist(
      ctx,
      formId,
      input.conditions.map((condition) => condition.source_field_id)
    );

    if (missing.length > 0) {
      return fail(
        `Ces questions n’existent pas sur ce formulaire : ${missing.join(', ')}. Appelez describe_form pour connaître les identifiants.`
      );
    }

    const { data: form } = await ctx.supabase
      .from('forms')
      .select('email_config')
      .eq('id', formId)
      .maybeSingle();

    if (!form) return fail('Ce formulaire est introuvable.');

    const config = { ...((form.email_config as Record<string, unknown>) ?? {}) };
    const rules = [...((config.rules as unknown[]) ?? [])];

    rules.push({
      id: `rule_${Date.now().toString(36)}`,
      subject: { fr: input.subject },
      body: { fr: input.message },
      operator: input.conditions_operator ?? 'AND',
      conditions: input.conditions.map((condition) => ({
        source_field_id: condition.source_field_id,
        operator: condition.operator,
        value: condition.value ?? ''
      }))
    });

    const { error } = await ctx.supabase
      .from('forms')
      .update({ email_config: { ...config, enabled: true, rules } })
      .eq('id', formId);

    if (error) return fail('La règle d’e-mail n’a pas pu être enregistrée.');

    return ok('Message conditionnel ajouté.');
  }
};

// ============================================================================
// Partenaires
// ============================================================================

const enablePartners: ToolDefinition = {
  name: 'enable_partners',
  description:
    'Active le programme partenaire du projet courant et fixe le taux de commission, en pourcentage du total de chaque inscription encaissée.',
  schema: z.object({
    enabled: z.boolean(),
    commission_percent: z.number().min(0).max(100).optional()
  }),
  mutates: false,
  async run(input: { enabled: boolean; commission_percent?: number }, ctx) {
    if (!ctx.projectId) return fail(NO_PROJECT);

    const { data: project } = await ctx.supabase
      .from('projects')
      .select('partner_config, modules')
      .eq('id', ctx.projectId)
      .maybeSingle();

    if (!project) return fail('Ce projet est introuvable.');

    const config = { ...((project.partner_config as object) ?? {}), enabled: input.enabled };
    if (input.commission_percent !== undefined) {
      (config as Record<string, unknown>).commission_percent = input.commission_percent;
    }

    const { error } = await ctx.supabase
      .from('projects')
      .update({
        partner_config: config,
        modules: { ...DEFAULT_PROJECT_MODULES, ...((project.modules as object) ?? {}), partners: input.enabled }
      })
      .eq('id', ctx.projectId);

    if (error) return fail('Le programme partenaire n’a pas pu être enregistré.');

    return ok(input.enabled ? 'Programme partenaire activé.' : 'Programme partenaire désactivé.');
  }
};

const createPartner: ToolDefinition = {
  name: 'create_partner',
  description:
    'Crée une fiche partenaire dans l’annuaire de l’espace de travail. N’ouvre AUCUN accès : le portail s’ouvre à la main depuis l’annuaire.',
  schema: z.object({
    name: z.string().min(1).max(120),
    email: z.string().email().optional(),
    website: z.string().max(200).optional()
  }),
  mutates: false,
  async run(input: { name: string; email?: string; website?: string }, ctx) {
    const { data, error } = await ctx.supabase
      .from('partners')
      .insert({
        team_id: ctx.teamId,
        created_by: ctx.userId,
        name: input.name,
        email: (input.email ?? '').toLowerCase(),
        website: input.website ?? ''
      })
      .select('id, name')
      .single();

    if (error) {
      return fail(
        'Le partenaire n’a pas pu être créé. Une fiche porte peut-être déjà cette adresse e-mail.'
      );
    }

    return ok(`Partenaire « ${data.name} » ajouté à l’annuaire.`, { partner_id: data.id });
  }
};

const linkPartnerToProject: ToolDefinition = {
  name: 'link_partner_to_project',
  description:
    'Rattache un partenaire de l’annuaire au projet courant et lui fabrique son lien de partage /a/<code>.',
  schema: z.object({ partner_id: z.string().uuid() }),
  mutates: false,
  async run(input: { partner_id: string }, ctx) {
    if (!ctx.projectId) return fail(NO_PROJECT);

    const { data: partner } = await ctx.supabase
      .from('partners')
      .select('id, name')
      .eq('id', input.partner_id)
      .maybeSingle();

    if (!partner) return fail('Ce partenaire est introuvable.');

    const { data, error } = await ctx.supabase
      .from('project_partners')
      .insert({
        project_id: ctx.projectId,
        partner_id: partner.id,
        created_by: ctx.userId,
        code: generatePartnerCode(partner.name)
      })
      .select('code')
      .single();

    if (error) {
      return fail(`« ${partner.name} » participe peut-être déjà à ce projet.`);
    }

    return ok(`Lien de partage créé : /a/${data.code}`, { code: data.code });
  }
};

// ============================================================================
// Intégrations
// ============================================================================

const connectSheet: ToolDefinition = {
  name: 'connect_sheet',
  description:
    'Désigne la feuille Google où écrire les réponses du formulaire courant. Le compte Google doit déjà être connecté dans Paramètres → Intégrations : cet outil ne peut pas l’autoriser à votre place.',
  schema: z.object({
    spreadsheet_id: z.string().min(10).describe('Identifiant du classeur, tiré de son URL.'),
    sheet_title: z.string().max(100).optional().describe('Nom de l’onglet. « Réponses » par défaut.'),
    include_metadata: z.boolean().optional()
  }),
  mutates: false,
  async run(
    input: { spreadsheet_id: string; sheet_title?: string; include_metadata?: boolean },
    ctx
  ) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const { error } = await ctx.supabase.from('form_integrations').upsert(
      {
        form_id: formId,
        provider: 'google_sheets',
        created_by: ctx.userId,
        config: {
          spreadsheet_id: input.spreadsheet_id,
          sheet_title: input.sheet_title ?? 'Réponses',
          include_metadata: input.include_metadata ?? true
        },
        is_active: true
      },
      { onConflict: 'form_id,provider' }
    );

    if (error) return fail('La feuille n’a pas pu être enregistrée.');

    return ok(
      'Feuille enregistrée. Si le compte Google de l’espace n’est pas encore connecté, la synchronisation restera en attente.'
    );
  }
};

const mapColumns: ToolDefinition = {
  name: 'map_columns',
  description:
    'Répartit les réponses dans plusieurs onglets selon une question : chaque valeur écrit dans son onglet.',
  schema: z.object({
    split_field_id: z.string().uuid().describe('La question qui décide de l’onglet.'),
    rules: z
      .array(
        z.object({
          value: z.string().describe('Identifiant de l’option.'),
          tab: z.string().min(1).max(100).describe('Nom de l’onglet de destination.')
        })
      )
      .min(1)
  }),
  mutates: false,
  async run(
    input: { split_field_id: string; rules: { value: string; tab: string }[] },
    ctx
  ) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const { data: integration } = await ctx.supabase
      .from('form_integrations')
      .select('id, config')
      .eq('form_id', formId)
      .eq('provider', 'google_sheets')
      .maybeSingle();

    if (!integration) {
      return fail('Aucune feuille n’est reliée à ce formulaire. Appelez connect_sheet d’abord.');
    }

    const { error } = await ctx.supabase
      .from('form_integrations')
      .update({
        config: {
          ...((integration.config as object) ?? {}),
          split_field_id: input.split_field_id,
          split_rules: input.rules
        }
      })
      .eq('id', integration.id);

    if (error) return fail('La répartition n’a pas pu être enregistrée.');

    return ok(`${input.rules.length} règle(s) de répartition enregistrée(s).`);
  }
};

// ============================================================================
// Publication
// ============================================================================

const publishForm: ToolDefinition = {
  name: 'publish_form',
  description:
    'Publie le formulaire courant — il devient accessible à son adresse publique — ou le repasse en brouillon.',
  schema: z.object({ published: z.boolean() }),
  mutates: true,
  async run(input: { published: boolean }, ctx) {
    const formId = requireForm(ctx);
    if (!formId) return fail(NO_FORM);

    const { count } = await ctx.supabase
      .from('fields')
      .select('id', { count: 'exact', head: true })
      .eq('form_id', formId);

    if (input.published && (count ?? 0) === 0) {
      return fail('Ce formulaire n’a aucune question : le publier n’aurait rien à montrer.');
    }

    const { data, error } = await ctx.supabase
      .from('forms')
      .update({
        status: input.published ? 'published' : 'draft',
        ...(input.published ? { published_at: new Date().toISOString() } : {})
      })
      .eq('id', formId)
      .select('slug')
      .single();

    if (error) return fail('Le formulaire n’a pas pu être publié.');

    return ok(input.published ? `Formulaire publié : /f/${data.slug}` : 'Formulaire repassé en brouillon.');
  }
};

// ============================================================================
// Le registre
// ============================================================================

export const TOOLS: ToolDefinition[] = [
  describeProject,
  describeForm,
  createProject,
  setProjectModules,
  setBranding,
  createForm,
  renameForm,
  openForm,
  addSection,
  updateSection,
  moveSection,
  deleteSection,
  addField,
  updateField,
  setOptions,
  setValidation,
  setVisibility,
  moveField,
  deleteField,
  addLogicRule,
  deleteLogicRule,
  enablePricing,
  setCurrencyVat,
  priceOption,
  addDiscountCode,
  setTiers,
  setEmailDefault,
  addEmailRule,
  enablePartners,
  createPartner,
  linkPartnerToProject,
  connectSheet,
  mapColumns,
  publishForm
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/**
 * Les outils, décrits pour l'API Responses d'OpenAI.
 *
 * `strict: false` : le mode strict d'OpenAI exige que TOUTE propriété figure
 * dans `required`, y compris les facultatives. Nos outils en ont beaucoup — un
 * `update_field` qui ne change que le libellé en est l'exemple — et les rendre
 * obligatoires forcerait le modèle à réécrire des valeurs qu'il ne veut pas
 * toucher. La validation Zod, elle, reste stricte à l'exécution.
 */
export function toolsForOpenAI() {
  return TOOLS.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    strict: false,
    parameters: z.toJSONSchema(tool.schema, { io: 'input' }) as Record<string, unknown>
  }));
}

/**
 * Exécute un appel d'outil.
 *
 * Toute exception est ramenée à un `ToolResult` en échec : le modèle doit
 * pouvoir lire ce qui s'est passé et corriger son appel suivant. Laisser une
 * exception remonter interromprait le tour, et l'utilisateur verrait une
 * conversation s'arrêter au milieu sans explication.
 */
export async function runTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return fail(`Outil inconnu : ${name}.`);

  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join(' ; ');
    return fail(`Paramètres refusés pour ${name} — ${issues}`);
  }

  try {
    return await tool.run(parsed.data as never, ctx);
  } catch (error) {
    console.error(`Outil ${name} en échec:`, error);
    return fail(`L’outil ${name} a échoué. Réessayez autrement.`);
  }
}
