import type { Form } from '@/types';

/**
 * Modèles Mooove officiels — seedés en dur.
 *
 * Quand Supabase sera branché, on remplira la table `forms` avec ces enregistrements
 * (scope = 'global'). En attendant, ils sont retournés tels quels par le store.
 *
 * Conventions :
 * - `id` stable et préfixé `tpl-mooove-<slug>` pour pouvoir les reconnaître / mettre à jour
 * - tous les champs ont des IDs stables `<template_slug>-<n>` pour que le clone fonctionne
 */

const now = '2026-01-01T00:00:00.000Z';

function ml(fr: string) {
  return { fr };
}

export const MOOOOVE_TEMPLATES: Form[] = [
  // ===========================================================================
  // 1. NPS (Net Promoter Score)
  // ===========================================================================
  {
    id: 'tpl-mooove-nps',
    team_id: 'mooove',
    title: 'Sondage NPS',
    slug: 'sondage-nps',
    description: 'Mesurez la satisfaction et la recommandation de vos clients.',
    display_mode: 'typeform',
    status: 'published',
    is_template: true,
    template_origin_id: null,
    scope: 'global',
    template_category: 'Satisfaction',
    template_description: 'Score de recommandation 0-10 + raison libre. Le standard pour mesurer la fidélité.',
    template_icon: 'Smile',
    theme: {
      bg: '#EFF9FE',
      accent: '#052139',
      font: 'Aktiv Grotesk',
      bg_type: 'preset',
      bg_preset: 'ice'
    },
    access_type: 'public',
    languages: ['fr'],
    default_language: 'fr',
    fields: [
      {
        id: 'nps-1',
        form_id: 'tpl-mooove-nps',
        type: 'nps',
        label: ml('Sur une échelle de 0 à 10, quelle est la probabilité que vous nous recommandiez à un ami ou collègue ?'),
        description: ml(''),
        placeholder: ml(''),
        options: [],
        required: true,
        field_order: 0,
        validation: {}
      },
      {
        id: 'nps-2',
        form_id: 'tpl-mooove-nps',
        type: 'long_text',
        label: ml('Qu\'est-ce qui motive principalement cette note ?'),
        description: ml(''),
        placeholder: ml('Ce que vous avez aimé, ce qui pourrait être amélioré…'),
        options: [],
        required: false,
        field_order: 1,
        validation: { max: 1000 }
      },
      {
        id: 'nps-3',
        form_id: 'tpl-mooove-nps',
        type: 'email',
        label: ml('Votre email (optionnel — pour qu\'on puisse revenir vers vous)'),
        description: ml(''),
        placeholder: ml('vous@exemple.com'),
        options: [],
        required: false,
        field_order: 2,
        validation: {}
      }
    ],
    logic_rules: [],
    save_and_resume: true,
    unique_email: true,
    published_at: null,
    closes_at: null,
    created_at: now,
    updated_at: now
  },

  // ===========================================================================
  // 2. Satisfaction client
  // ===========================================================================
  {
    id: 'tpl-mooove-satisfaction',
    team_id: 'mooove',
    title: 'Satisfaction client',
    slug: 'satisfaction-client',
    description: 'Évaluez l\'expérience après un service rendu.',
    display_mode: 'sections',
    status: 'published',
    is_template: true,
    template_origin_id: null,
    scope: 'global',
    template_category: 'Satisfaction',
    template_description: 'Note étoiles + retour structuré pour comprendre ce qui marche et ce qui coince.',
    template_icon: 'Star',
    theme: {
      bg: '#EFF9FE',
      accent: '#052139',
      font: 'Aktiv Grotesk',
      bg_type: 'preset',
      bg_preset: 'ice'
    },
    access_type: 'public',
    languages: ['fr'],
    default_language: 'fr',
    fields: [
      {
        id: 'sat-1',
        form_id: 'tpl-mooove-satisfaction',
        type: 'rating',
        label: ml('Comment évaluez-vous votre expérience globale ?'),
        description: ml(''),
        placeholder: ml(''),
        options: [],
        required: true,
        field_order: 0,
        validation: { max: 5 }
      },
      {
        id: 'sat-2',
        form_id: 'tpl-mooove-satisfaction',
        type: 'single_choice',
        label: ml('Quel aspect vous a le plus marqué ?'),
        description: ml(''),
        placeholder: ml(''),
        options: [
          { id: 'sat-2-a', label: ml('Qualité du produit / service') },
          { id: 'sat-2-b', label: ml('Réactivité de l\'équipe') },
          { id: 'sat-2-c', label: ml('Rapport qualité / prix') },
          { id: 'sat-2-d', label: ml('Simplicité d\'utilisation') }
        ],
        required: true,
        field_order: 1,
        validation: { display_style: 'cards', options_columns: 2 }
      },
      {
        id: 'sat-3',
        form_id: 'tpl-mooove-satisfaction',
        type: 'long_text',
        label: ml('Y a-t-il quelque chose qu\'on pourrait améliorer ?'),
        description: ml(''),
        placeholder: ml('Soyez aussi précis que possible — votre retour nous est précieux'),
        options: [],
        required: false,
        field_order: 2,
        validation: { max: 1500 }
      },
      {
        id: 'sat-4',
        form_id: 'tpl-mooove-satisfaction',
        type: 'email',
        label: ml('Votre email (si vous souhaitez un retour)'),
        description: ml(''),
        placeholder: ml('vous@exemple.com'),
        options: [],
        required: false,
        field_order: 3,
        validation: {}
      }
    ],
    logic_rules: [],
    save_and_resume: true,
    unique_email: true,
    published_at: null,
    closes_at: null,
    created_at: now,
    updated_at: now
  },

  // ===========================================================================
  // 3. Brief créatif / projet
  // ===========================================================================
  {
    id: 'tpl-mooove-brief',
    team_id: 'mooove',
    title: 'Brief créatif',
    slug: 'brief-creatif',
    description: 'Collectez les éléments d\'un projet avant de commencer.',
    display_mode: 'sections',
    status: 'published',
    is_template: true,
    template_origin_id: null,
    scope: 'global',
    template_category: 'Projet',
    template_description: 'Le brief idéal pour démarrer un projet client : objectifs, deadline, références, budget.',
    template_icon: 'Lightbulb',
    theme: {
      bg: '#EFF9FE',
      accent: '#052139',
      font: 'Aktiv Grotesk',
      bg_type: 'preset',
      bg_preset: 'ice'
    },
    access_type: 'public',
    languages: ['fr'],
    default_language: 'fr',
    fields: [
      {
        id: 'brief-1',
        form_id: 'tpl-mooove-brief',
        type: 'short_text',
        label: ml('Nom du projet'),
        description: ml(''),
        placeholder: ml('Ex : Refonte site vitrine'),
        options: [],
        required: true,
        field_order: 0,
        validation: {}
      },
      {
        id: 'brief-2',
        form_id: 'tpl-mooove-brief',
        type: 'long_text',
        label: ml('Décrivez le projet en quelques phrases'),
        description: ml(''),
        placeholder: ml('Contexte, objectifs principaux, cible…'),
        options: [],
        required: true,
        field_order: 1,
        validation: { max: 2000 }
      },
      {
        id: 'brief-3',
        form_id: 'tpl-mooove-brief',
        type: 'date',
        label: ml('Date de livraison souhaitée'),
        description: ml(''),
        placeholder: ml(''),
        options: [],
        required: false,
        field_order: 2,
        validation: {}
      },
      {
        id: 'brief-4',
        form_id: 'tpl-mooove-brief',
        type: 'single_choice',
        label: ml('Budget estimé'),
        description: ml(''),
        placeholder: ml(''),
        options: [
          { id: 'brief-4-a', label: ml('Moins de 5 000 €') },
          { id: 'brief-4-b', label: ml('5 000 – 15 000 €') },
          { id: 'brief-4-c', label: ml('15 000 – 50 000 €') },
          { id: 'brief-4-d', label: ml('Plus de 50 000 €') },
          { id: 'brief-4-e', label: ml('À définir ensemble') }
        ],
        required: false,
        field_order: 3,
        validation: { options_columns: 2 }
      },
      {
        id: 'brief-5',
        form_id: 'tpl-mooove-brief',
        type: 'long_text',
        label: ml('Références ou inspirations'),
        description: ml(''),
        placeholder: ml('Liens, captures, mots-clés…'),
        options: [],
        required: false,
        field_order: 4,
        validation: { max: 1500 }
      },
      {
        id: 'brief-6',
        form_id: 'tpl-mooove-brief',
        type: 'email',
        label: ml('Votre email de contact'),
        description: ml(''),
        placeholder: ml('vous@exemple.com'),
        options: [],
        required: true,
        field_order: 5,
        validation: {}
      }
    ],
    logic_rules: [],
    save_and_resume: true,
    unique_email: false,
    published_at: null,
    closes_at: null,
    created_at: now,
    updated_at: now
  },

  // ===========================================================================
  // 4. Inscription événement
  // ===========================================================================
  {
    id: 'tpl-mooove-event',
    team_id: 'mooove',
    title: 'Inscription à un événement',
    slug: 'inscription-evenement',
    description: 'Recueillez les inscriptions et les préférences des participants.',
    display_mode: 'sections',
    status: 'published',
    is_template: true,
    template_origin_id: null,
    scope: 'global',
    template_category: 'Événement',
    template_description: 'Nom, contact, choix de session, restrictions alimentaires. Tout pour organiser sereinement.',
    template_icon: 'Calendar',
    theme: {
      bg: '#EFF9FE',
      accent: '#052139',
      font: 'Aktiv Grotesk',
      bg_type: 'preset',
      bg_preset: 'ice'
    },
    access_type: 'public',
    languages: ['fr'],
    default_language: 'fr',
    fields: [
      {
        id: 'evt-1',
        form_id: 'tpl-mooove-event',
        type: 'short_text',
        label: ml('Prénom'),
        description: ml(''),
        placeholder: ml(''),
        options: [],
        required: true,
        field_order: 0,
        validation: {},
        layout_width: 'half'
      },
      {
        id: 'evt-2',
        form_id: 'tpl-mooove-event',
        type: 'short_text',
        label: ml('Nom'),
        description: ml(''),
        placeholder: ml(''),
        options: [],
        required: true,
        field_order: 1,
        validation: {},
        layout_width: 'half'
      },
      {
        id: 'evt-3',
        form_id: 'tpl-mooove-event',
        type: 'email',
        label: ml('Email'),
        description: ml(''),
        placeholder: ml('vous@exemple.com'),
        options: [],
        required: true,
        field_order: 2,
        validation: {}
      },
      {
        id: 'evt-4',
        form_id: 'tpl-mooove-event',
        type: 'phone',
        label: ml('Téléphone'),
        description: ml(''),
        placeholder: ml(''),
        options: [],
        required: false,
        field_order: 3,
        validation: { default_country: 'MU' }
      },
      {
        id: 'evt-5',
        form_id: 'tpl-mooove-event',
        type: 'multiple_choice',
        label: ml('À quelles sessions souhaitez-vous participer ?'),
        description: ml(''),
        placeholder: ml(''),
        options: [
          { id: 'evt-5-a', label: ml('Matinée') },
          { id: 'evt-5-b', label: ml('Déjeuner') },
          { id: 'evt-5-c', label: ml('Après-midi') },
          { id: 'evt-5-d', label: ml('Cocktail du soir') }
        ],
        required: true,
        field_order: 4,
        validation: { selection_min: 1, options_columns: 2 }
      },
      {
        id: 'evt-6',
        form_id: 'tpl-mooove-event',
        type: 'long_text',
        label: ml('Restrictions alimentaires / allergies'),
        description: ml(''),
        placeholder: ml('Aucune, végétarien, sans gluten…'),
        options: [],
        required: false,
        field_order: 5,
        validation: { max: 300 }
      }
    ],
    logic_rules: [],
    save_and_resume: true,
    unique_email: true,
    published_at: null,
    closes_at: null,
    created_at: now,
    updated_at: now
  },

  // ===========================================================================
  // 5. Candidature
  // ===========================================================================
  {
    id: 'tpl-mooove-candidature',
    team_id: 'mooove',
    title: 'Candidature',
    slug: 'candidature',
    description: 'Recevez des candidatures structurées pour un poste à pourvoir.',
    display_mode: 'sections',
    status: 'published',
    is_template: true,
    template_origin_id: null,
    scope: 'global',
    template_category: 'RH',
    template_description: 'Identité, CV, expérience, motivation. Le minimum pour un premier tri propre.',
    template_icon: 'Briefcase',
    theme: {
      bg: '#EFF9FE',
      accent: '#052139',
      font: 'Aktiv Grotesk',
      bg_type: 'preset',
      bg_preset: 'ice'
    },
    access_type: 'public',
    languages: ['fr'],
    default_language: 'fr',
    fields: [
      {
        id: 'cand-1',
        form_id: 'tpl-mooove-candidature',
        type: 'short_text',
        label: ml('Prénom et nom'),
        description: ml(''),
        placeholder: ml(''),
        options: [],
        required: true,
        field_order: 0,
        validation: {}
      },
      {
        id: 'cand-2',
        form_id: 'tpl-mooove-candidature',
        type: 'email',
        label: ml('Email'),
        description: ml(''),
        placeholder: ml('vous@exemple.com'),
        options: [],
        required: true,
        field_order: 1,
        validation: {},
        layout_width: 'half'
      },
      {
        id: 'cand-3',
        form_id: 'tpl-mooove-candidature',
        type: 'phone',
        label: ml('Téléphone'),
        description: ml(''),
        placeholder: ml(''),
        options: [],
        required: false,
        field_order: 2,
        validation: { default_country: 'MU' },
        layout_width: 'half'
      },
      {
        id: 'cand-4',
        form_id: 'tpl-mooove-candidature',
        type: 'single_choice',
        label: ml('Années d\'expérience dans le domaine'),
        description: ml(''),
        placeholder: ml(''),
        options: [
          { id: 'cand-4-a', label: ml('Moins d\'1 an') },
          { id: 'cand-4-b', label: ml('1 – 3 ans') },
          { id: 'cand-4-c', label: ml('3 – 5 ans') },
          { id: 'cand-4-d', label: ml('5 – 10 ans') },
          { id: 'cand-4-e', label: ml('Plus de 10 ans') }
        ],
        required: true,
        field_order: 3,
        validation: { display_style: 'buttons', options_columns: 3 }
      },
      {
        id: 'cand-5',
        form_id: 'tpl-mooove-candidature',
        type: 'long_text',
        label: ml('Pourquoi ce poste vous intéresse-t-il ?'),
        description: ml(''),
        placeholder: ml('En quelques lignes — ce qui vous attire, ce que vous apporteriez…'),
        options: [],
        required: true,
        field_order: 4,
        validation: { max: 2000 }
      },
      {
        id: 'cand-6',
        form_id: 'tpl-mooove-candidature',
        type: 'file',
        label: ml('CV (PDF de préférence)'),
        description: ml(''),
        placeholder: ml(''),
        options: [],
        required: true,
        field_order: 5,
        validation: {}
      },
      {
        id: 'cand-7',
        form_id: 'tpl-mooove-candidature',
        type: 'url',
        label: ml('Lien LinkedIn ou portfolio (optionnel)'),
        description: ml(''),
        placeholder: ml('https://…'),
        options: [],
        required: false,
        field_order: 6,
        validation: {}
      }
    ],
    logic_rules: [],
    save_and_resume: true,
    unique_email: true,
    published_at: null,
    closes_at: null,
    created_at: now,
    updated_at: now
  },

  // ===========================================================================
  // 6. Feedback produit
  // ===========================================================================
  {
    id: 'tpl-mooove-feedback',
    team_id: 'mooove',
    title: 'Feedback produit',
    slug: 'feedback-produit',
    description: 'Recueillez l\'avis de vos utilisateurs sur une fonctionnalité.',
    display_mode: 'typeform',
    status: 'published',
    is_template: true,
    template_origin_id: null,
    scope: 'global',
    template_category: 'Produit',
    template_description: 'Court et ciblé : ce qui plaît, ce qui manque, ce qui agace. Idéal après une mise à jour.',
    template_icon: 'MessageSquare',
    theme: {
      bg: '#EFF9FE',
      accent: '#052139',
      font: 'Aktiv Grotesk',
      bg_type: 'preset',
      bg_preset: 'ice'
    },
    access_type: 'public',
    languages: ['fr'],
    default_language: 'fr',
    fields: [
      {
        id: 'fb-1',
        form_id: 'tpl-mooove-feedback',
        type: 'rating',
        label: ml('Globalement, à quel point êtes-vous satisfait·e de cette nouveauté ?'),
        description: ml(''),
        placeholder: ml(''),
        options: [],
        required: true,
        field_order: 0,
        validation: { max: 5 }
      },
      {
        id: 'fb-2',
        form_id: 'tpl-mooove-feedback',
        type: 'long_text',
        label: ml('Qu\'est-ce que vous appréciez le plus ?'),
        description: ml(''),
        placeholder: ml('Une chose précise — ce qui vous a marqué'),
        options: [],
        required: false,
        field_order: 1,
        validation: { max: 800 }
      },
      {
        id: 'fb-3',
        form_id: 'tpl-mooove-feedback',
        type: 'long_text',
        label: ml('Qu\'est-ce qui manque ou ne va pas ?'),
        description: ml(''),
        placeholder: ml('Soyez direct·e — c\'est utile'),
        options: [],
        required: false,
        field_order: 2,
        validation: { max: 800 }
      },
      {
        id: 'fb-4',
        form_id: 'tpl-mooove-feedback',
        type: 'multiple_choice',
        label: ml('À quelle fréquence utilisez-vous le produit ?'),
        description: ml(''),
        placeholder: ml(''),
        options: [
          { id: 'fb-4-a', label: ml('Tous les jours') },
          { id: 'fb-4-b', label: ml('Plusieurs fois par semaine') },
          { id: 'fb-4-c', label: ml('Quelques fois par mois') },
          { id: 'fb-4-d', label: ml('Rarement') }
        ],
        required: false,
        field_order: 3,
        validation: { selection_max: 1 }
      }
    ],
    logic_rules: [],
    save_and_resume: true,
    unique_email: false,
    published_at: null,
    closes_at: null,
    created_at: now,
    updated_at: now
  }
];

export function getMoooveTemplate(id: string): Form | null {
  return MOOOOVE_TEMPLATES.find((t) => t.id === id) ?? null;
}
