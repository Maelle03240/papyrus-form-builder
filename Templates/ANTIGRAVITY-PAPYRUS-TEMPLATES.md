# Papyrus — Refonte de la Galerie de Modèles

> **Spécification d'implémentation — à donner telle quelle à Antigravity.**
> Projet : `papyrus-form-builder-1` · Next.js 14 App Router · TypeScript strict · Supabase auto-hébergé (schéma `papyrus`) · Cloudflare R2 · Tailwind · Framer Motion · @dnd-kit · Recharts.
> Déploiement : Easypanel, projet `main`, service `papyrus`.
>
> **Cette spécification respecte intégralement `CLAUDE.md`.** Toute règle non négociable qui s'y trouve (R2 pour les médias, schéma `papyrus`, secrets en Environment Easypanel, RLS par commande, zéro `any`, tokens CSS Mooove) reste en vigueur ici et est rappelée là où elle s'applique.

---

## 0. Résumé exécutif

### Ce qui est livré avec cette spec

| Fichier | Contenu |
|---|---|
| `catalog/*.json` | **51 modèles bilingues FR/EN**, 608 blocs (499 questions + 109 sauts de section), 30 règles de logique conditionnelle, 4 formulaires notés. Prêts à copier dans le dépôt. |
| `catalog/index.json` | Index léger (37 Ko) — métadonnées uniquement, destiné au navigateur. |
| `catalog/_order.json` | Ordre d'affichage imposé du catalogue. Lu par le script de build. |
| `catalog-generated.ts` | Le barrel TypeScript auto-généré (exemple de sortie attendue du script de build). |
| `papyrus-templates-gallery.html` | Galerie de référence navigable — sert de recette de validation du contenu. |

### Verdict sur la question « Papyrus peut-il faire tous les types de formulaires ? »

**Réponse : 84 % oui, aujourd'hui, sans une ligne de code supplémentaire.** Sur les 51 modèles conçus à partir des catalogues Tally, Jotform, Microsoft Forms et 123FormBuilder :

- **43 modèles (84 %)** sont intégralement réalisables avec les 18 types de champs existants ;
- **7 modèles (14 %)** sont réalisables mais avec un contournement visible (créneau horaire en liste déroulante figée, total saisi à la main, signature remplacée par un nom tapé) ;
- **1 modèle (2 %)** est réellement bloqué : le bon de commande, qui exige un champ paiement.

Papyrus est déjà **au-dessus** de Google Forms et de Microsoft Forms sur les capacités (modes d'affichage multiples, médias, matrices, scoring, logique, multilingue, thèmes). Il est **au niveau** de Tally sur l'essentiel. Il est **en dessous** de Jotform et de 123FormBuilder sur exactement cinq points, listés en Phase 4.

### Le vrai blocage n'est pas les types de champs

**`cloneTemplate()` est cassé, et de deux façons différentes.**

1. Pour un modèle **global** (les 6 seeds Mooove, et demain les 51 du catalogue), il **lève une erreur** : la fonction écrit `template_origin_id: template.id`, or cette colonne est un `uuid` et l'identifiant vaut `tpl-mooove-nps`. PostgreSQL rejette avec `22P02 invalid input syntax for type uuid`. Le clonage d'un modèle officiel ne fonctionne tout simplement pas.
2. Pour un modèle **personnel ou d'équipe** (dont l'identifiant est un vrai UUID), il fonctionne mais **détruit silencieusement** la logique conditionnelle, les points de scoring et les réglages.

Publier 51 modèles riches par-dessus cette fonction ne produirait rien du tout. **La Phase 1 est bloquante et doit être faite en premier.**

### Ordre d'exécution

| Phase | Objet | Bloquant | Effort |
|---|---|---|---|
| **0** | Trois correctifs d'une ligne | 🔴 Oui | XS |
| **1** | Réparer le clonage de modèle | 🔴 Oui | S |
| **2** | Sortir le catalogue du bundle navigateur | 🔴 Oui | M |
| **3** | Refondre la page `/templates` | 🟠 Recommandé | M |
| **4** | Nouveaux types de champs | 🟢 Non | L |
| **5** | Page publique SEO `/modeles` | 🟢 Non | M |

---

## 0 bis. PHASE 0 — Trois correctifs préalables 🔴

Trois anomalies préexistantes, sans rapport direct avec les modèles, mais qui gênent la suite.

#### 0.1 — Le champ `number` est inaccessible depuis la palette

`lib/field-meta.ts` déclare bien `number` dans `FIELD_META`, mais **`FIELD_CATEGORIES` ne le contient dans aucune de ses 5 familles**. Or `FieldPalette.tsx` itère sur `FIELD_CATEGORIES` : le champ Nombre n'apparaît donc jamais dans la palette du builder. Le catalogue l'utilise 16 fois.

```ts
// lib/field-meta.ts
export const FIELD_CATEGORIES: { title: string; types: FieldType[] }[] = [
  { title: 'Texte', types: ['short_text', 'long_text', 'email', 'phone', 'url'] },
  { title: 'Choix', types: ['single_choice', 'multiple_choice', 'dropdown'] },
  { title: 'Évaluation', types: ['rating', 'nps', 'matrix'] },
  { title: 'Données', types: ['number', 'date', 'file'] },   // ← ajouter 'number'
  { title: 'Mise en page', types: ['section_break', 'statement', 'image', 'video'] }
];
```

#### 0.2 — `tsx` n'est pas installé

Les scripts de la Phase 2 en ont besoin. `server-only`, en revanche, est **déjà** dans les dépendances : ne pas le réinstaller.

```bash
npm i -D tsx
```

#### 0.3 — Vérifier que `/api/templates/*` passe le middleware

`middleware.ts` applique `updateSession` à tout sauf les fichiers statiques ; `/api/templates/*` sera donc traversé. Avant d'écrire les routes de la Phase 2, lire `lib/supabase/middleware.ts` et repérer la liste des chemins laissés passer sans session (celle qui autorise déjà `/f/…` et `/api/submit/…`). Y ajouter `/api/templates` — **une entrée explicite, jamais un motif large**.

---

## 1. État des lieux — ce que Papyrus sait déjà faire

*(Section de contexte pour l'agent. Ne rien modifier ici, c'est un constat.)*

### 1.1 Les 18 types de champs (`types/index.ts`, `lib/field-meta.ts`)

| Famille | Types | Capacités notables |
|---|---|---|
| Texte | `short_text`, `long_text`, `email`, `phone`, `url` | `short_text` accepte `response_type: 'integer' \| 'decimal'` et une `unit` (dont `mur`, `euro`, `percent`) ; `phone` gère l'indicatif international avec `default_country` |
| Choix | `single_choice`, `multiple_choice`, `dropdown` | `display_style: cards \| buttons \| slider`, `options_columns: 1\|2\|3`, `has_other`, `randomize_options`, `selection_min` / `selection_max`, et **sous-questions par option cochée** (`subfields`) — une capacité que Tally n'a pas |
| Évaluation | `rating`, `nps`, `matrix` | `matrix` en mode `single` ou `multiple`, jusqu'à 20 lignes × 10 colonnes |
| Données | `date`, `file` *(et `number`, cf. Phase 0.1)* | `file` : `accept`, `max_file_size_mb` jusqu'à 50 |
| Mise en page | `section_break`, `statement`, `image`, `video` | `image` et `video` ont un **double mode** : contenu ajouté par le créateur, ou upload par le répondant |

> `FIELD_CATEGORIES` ne compte que **5 familles**, et `number` n'y figure dans aucune — c'est le correctif 0.1.

### 1.2 Capacités de formulaire déjà en place

- **3 modes d'affichage** : `scroll`, `sections` (pagination par `section_break`, cf. `lib/sections.ts`), `typeform` (une question par écran).
- **Logique conditionnelle** (`lib/logic-evaluation.ts`) : 6 opérateurs, conditions ET/OU, actions `show_field` / `hide_field` / `jump_to` / `end_form`.
- **Scoring** (`lib/scoring.ts`) : points par option sur `single_choice`, `multiple_choice`, `dropdown`, `matrix`, `rating`, `nps` ; niveaux de maturité personnalisables (`ScoreLevel[]`), affichage du score au répondant.
- **Multilingue** : `MultilingualText` sur chaque libellé de champ (`{ fr, en?, es?, … }`), plus `languages: string[]` et `default_language` sur le formulaire. *(L'interface `FieldTranslation` existe dans `types/index.ts` mais aucune table `field_translations` n'a jamais été créée en base — c'est du code mort.)*
- **Thème** : bannière, logo, dégradés, images de fond, couleurs de blocs, styles par champ, mode sombre.
- **Réglages** (`FormSettings`) : barre de progression, redirection, réponses partielles, rétention de données, plafond de réponses, anti-doublon, `auto_jump`, embed (standard / popup / pleine page).
- **Notifications** : email au créateur, email au répondant avec PDF joint.
- **Intégrations** : Google Sheets (sync + resync), import Tally.
- **Sécurité** : accès public / privé / mot de passe, RLS par commande, vues `public_forms` / `public_fields` / `public_logic_rules` qui n'exposent jamais `access_password`, `/api/submit/[slug]` avec validation, limitation de débit et hachage d'IP.

### 1.3 Ce qui manque réellement

| Manque | Ce que ça bloque | Concurrents qui l'ont |
|---|---|---|
| Type `time` | Prise de rendez-vous, réservation de table, transfert aéroport | Jotform, 123FormBuilder |
| Type `signature` | Consentement, décharge, contrat, autorisation d'image | Jotform, 123FormBuilder |
| Type `payment` | Bon de commande, don, billetterie, acompte | Jotform, 123FormBuilder, Tally (Pro) |
| Type `hidden` + préremplissage par URL | Attribution UTM, liens personnalisés, formulaires alimentés par le CRM | Tous |
| Champ calculé / formule | Devis chiffré, total de commande, calculateurs | Jotform, 123FormBuilder |
| Bloc `address` composite | Livraison, facturation (aujourd'hui : 4 champs séparés) | Tous |
| Type `ranking` | Priorisation dans les enquêtes | Tally, Jotform |
| Case de consentement unique obligatoire | CGU, RGPD (aujourd'hui : `single_choice` Oui/Non) | Tous |
| Groupe répétable (lignes de commande) | Note de frais multi-lignes, commande multi-produits | Jotform, 123FormBuilder |
| Anti-spam (honeypot / Turnstile) | Tout formulaire public exposé | Tous |

---

## 2. PHASE 1 — Réparer le clonage de modèle 🔴 BLOQUANT

### 2.1 Le bug

Fichier : `lib/store/templates.ts`, fonction `cloneTemplate()`.

```ts
// ÉTAT ACTUEL
const updated = await updateForm(fresh.id, {
  // …
  logic_rules: [],                      // ❌ 2. toute la logique conditionnelle est jetée
  unique_email: template.unique_email ?? true,   // ❌ 4. bascule à true si non défini
  template_origin_id: template.id,      // ❌ 1. ERREUR SQL sur un modèle global
  // ❌ 3. scoring_enabled, show_score_to_respondent, settings,
  //       notification_settings : jamais copiés
});

function remapField(field: Field, newFormId: string): Field {
  return {
    // …
    options: (field.options ?? []).map((o) => ({
      id: randomId(),
      label: cloneML(o.label),
      value: o.value                    // ❌ 5. `points` disparaît → le scoring est vidé
    })),
    // idem pour `rows` (matrices) et pour les options/rows des `subfields`
  };
}
```

**1. Erreur franche sur les modèles globaux.** `template_origin_id` est déclaré `uuid references papyrus.forms(id)` en migration 001. Les modèles globaux ont un identifiant textuel (`tpl-mooove-nps`). PostgreSQL échoue au **cast uuid** — `22P02 invalid input syntax for type uuid` — avant même d'évaluer la clé étrangère. Le clonage d'un modèle Mooove ne marche pas aujourd'hui.

**2 à 5 : pertes silencieuses** sur les modèles personnels et d'équipe (identifiants UUID valides), sans aucune erreur ni avertissement :

2. Un modèle avec logique conditionnelle est cloné **sans aucune logique**. Les champs censés être conditionnels deviennent tous visibles en permanence.
3. Un modèle noté est cloné avec `scoring_enabled = false` **et** sans les points sur les options — sur les options de choix, sur les colonnes de matrice, et sur celles des sous-questions. Le scoring est irrécupérable, même en le réactivant à la main.
4. `unique_email` passe à `true` quand le modèle ne le définit pas, alors que la valeur par défaut en base est `false`.
5. Les réglages (barre de progression, anti-doublon, plafond de réponses) reviennent aux valeurs par défaut.

Un sixième problème, latent : même si on copiait `logic_rules`, les règles référencent des `field_id` et des `option_id` qui viennent d'être remappés — il faut une table de correspondance, sinon les règles pointent dans le vide.

### 2.2 La solution : réutiliser `importForm`

La fonction `importForm()` de `lib/store/supabase-forms.ts` (ligne ~865) **fait déjà tout ce travail correctement** : elle construit `fieldIdMap` et `optionIdMap`, remappe `source_field_id`, `target_field_id` et la `value` des conditions (qui est un `option_id`), et préserve `points` grâce au spread `{...opt}`.

Il ne lui manque que quelques champs.

#### Étape 1.1 — Compléter `importForm`

Dans `lib/store/supabase-forms.ts`, objet `formData` de `importForm` (~ligne 948).

**Trois clés à AJOUTER** (elles ne sont pas dans l'objet actuel, et les colonnes existent bien en base — `save_and_resume` et `unique_email` en migration 001, `settings` et `notification_settings` en migration 002) :

```ts
save_and_resume: formJson.save_and_resume ?? true,
unique_email: formJson.unique_email ?? false,
settings: remapSettings(formJson.settings ?? {}, fieldIdMap),
notification_settings: remapNotifications(formJson.notification_settings ?? {}, fieldIdMap),
```

**Une clé à MODIFIER** (elle existe déjà, avec un défaut peu pertinent) :

```ts
// avant : display_mode: formJson.display_mode || 'scroll',
display_mode: formJson.display_mode || 'sections',
```

**Une clé à NE PAS TOUCHER : `template_origin_id`.** Elle vaut déjà `null` en dur dans `importForm`, et c'est exactement le bon comportement.

> ⚠️ **Ne surtout pas écrire `template_origin_id: formJson.template_origin_id ?? null`.** Cette colonne est un `uuid references papyrus.forms(id)`, et les modèles de catalogue ne sont pas des lignes en base — leur `id` est la chaîne `tpl-mooove-…`. C'est précisément le bug de la §2.1. Le `null` en dur est la protection.
> **L'origine se conserve dans `settings.template_origin_slug`** (texte libre, aucune contrainte). Cf. étape 1.4.

> ⚠️ **Ne pas ajouter `require_all_by_default`.** Cette propriété existe sur l'interface `Form` mais **il n'y a aucune colonne correspondante** dans `papyrus.forms` (ni migration 001 ni 002). L'ajouter à `formData` ferait échouer **tous** les imports et tous les clonages avec `PGRST204 – Could not find the column`. C'est aujourd'hui un réglage purement client.

#### Étape 1.2 — Remapper les identifiants de champs cachés dans les objets JSON

`importForm` remappe les identifiants de champs, mais **trois objets JSON contiennent eux aussi des `field_id`** et sont recopiés tels quels. Sans traitement, ils pointeraient vers les champs du formulaire d'origine — un nouveau bug silencieux introduit par le correctif lui-même.

| Objet | Chemins concernés |
|---|---|
| `FormSettings` | `duplicate_field_id` |
| `NotificationSettings` | `respondent.to_field_id` |
| `FormTheme` | `dashboard_config.chart_order[]`, `dashboard_config.chart_layout[].field_id`, les **clés** de `dashboard_config.chart_titles`, `dashboard_config.deleted_charts[]` |

Ajouter dans `lib/store/supabase-forms.ts` :

```ts
type IdMap = Record<string, string>;
const mapId = (id: string | undefined, m: IdMap) => (id ? m[id] ?? id : id);

function remapSettings(s: FormSettings, m: IdMap): FormSettings {
  return { ...s, duplicate_field_id: mapId(s.duplicate_field_id, m) };
}

function remapNotifications(n: NotificationSettings, m: IdMap): NotificationSettings {
  if (!n.respondent) return n;
  return { ...n, respondent: { ...n.respondent, to_field_id: mapId(n.respondent.to_field_id, m) ?? '' } };
}

function remapTheme(t: FormTheme, m: IdMap): FormTheme {
  const d = t.dashboard_config;
  if (!d) return t;
  return {
    ...t,
    dashboard_config: {
      ...d,
      chart_order: d.chart_order?.map((id) => mapId(id, m) as string),
      deleted_charts: d.deleted_charts?.map((id) => mapId(id, m) as string),
      chart_layout: d.chart_layout?.map((c) => ({ ...c, field_id: mapId(c.field_id, m) as string })),
      chart_titles: d.chart_titles
        ? Object.fromEntries(Object.entries(d.chart_titles).map(([k, v]) => [mapId(k, m) as string, v]))
        : undefined,
    },
  };
}
```

Puis, dans `formData`, remplacer `theme: formJson.theme || { … }` par `theme: remapTheme(formJson.theme ?? DEFAULT_THEME, fieldIdMap)`.

> Ce défaut existe **déjà** dans `importForm` pour `theme.dashboard_config` : le corriger règle aussi un bug latent de l'import de formulaire JSON.

#### Étape 1.3 — Remapper aussi les `subfields`

`importForm` propage `subfields` par spread sans remapper les identifiants. Les colonnes générées suivent le format `[field_id]__[option_slug]__[subfield_id]` (cf. `lib/submission-columns.ts`) — des identifiants dupliqués entre deux formulaires posent problème. Dans `mappedFields`, ajouter :

```ts
const mappedSubfields = (field.subfields ?? []).map((sf) => ({
  ...sf,
  id: uuid(),
  options: (sf.options ?? []).map((o) => ({ ...o, id: uuid() })),
  rows: sf.rows?.map((r) => ({ ...r, id: uuid() })),
}));
```
puis `subfields: mappedSubfields` dans l'objet retourné. *(Aucun modèle du catalogue n'utilise `subfields` — c'est une correction défensive, mais elle coûte trois lignes.)*

#### Étape 1.4 — Réécrire `cloneTemplate`

Remplacer intégralement le corps de `cloneTemplate` dans `lib/store/templates.ts` :

```ts
import { importForm } from './supabase-forms';
import type { Form, TemplateDefinition } from '@/types';

/**
 * Clone un modèle du catalogue dans les formulaires de l'utilisateur.
 * Délègue à `importForm`, qui remappe correctement les identifiants de champs,
 * d'options et de lignes — et donc les références des règles de logique.
 */
export async function cloneTemplate(form: Form): Promise<Form> {
  return importForm({
    ...form,
    is_template: false,
    scope: undefined,
    status: 'draft',
    template_origin_id: null,
    settings: {
      ...(form.settings ?? {}),
      // trace d'origine : chaîne libre, pas une FK
      template_origin_slug: form.slug,
    },
  });
}
```

Supprimer ensuite les fonctions `remapField`, `cloneML` et `randomId` de `lib/store/templates.ts` — elles deviennent mortes.

#### Étape 1.5 — Recette (obligatoire avant de passer à la Phase 2)

Créer un modèle de test à la main contenant : 2 règles `show_field`, un `single_choice` avec des `points`, `scoring_enabled = true`, `settings.progress_bar = true`, `settings.prevent_duplicates = true` avec un `duplicate_field_id`. Le cloner. Vérifier **en base** (`papyrus.logic_rules`, `papyrus.fields`, `papyrus.forms`) :

- [ ] Le clonage d'un modèle **global** (identifiant `tpl-mooove-…`) réussit — plus d'erreur `22P02`.
- [ ] `logic_rules` : 2 lignes, `source_field_id` et `target_field_id` pointent sur les **nouveaux** identifiants de champs.
- [ ] La `value` de chaque condition correspond au **nouvel** `option_id`.
- [ ] Les `points` sont présents sur les options en base.
- [ ] `scoring_enabled = true` sur le formulaire cloné.
- [ ] `settings->>'progress_bar' = 'true'`.
- [ ] `settings->>'duplicate_field_id'` pointe sur un champ **du nouveau formulaire**, pas de l'ancien.
- [ ] `template_origin_id` vaut `null` et `settings->>'template_origin_slug'` porte le slug d'origine.
- [ ] Ouvrir le formulaire cloné dans le builder : les champs conditionnels apparaissent bien comme conditionnels.
- [ ] Le publier et le remplir : la logique s'applique côté répondant, le score est calculé.

---

## 3. PHASE 2 — Sortir le catalogue du bundle navigateur 🔴 BLOQUANT

### 3.1 Le problème

`lib/templates/seeds.ts` contient 6 modèles en dur, et il est importé par `lib/store/templates.ts`, lui-même marqué `'use client'`. Les 6 modèles partent donc **dans le chunk JavaScript de la route `/templates`**.

*(Portée exacte : `lib/store/index.ts` ne réexporte que `./supabase-forms`, pas `./templates`. Le seul importateur est `app/(dashboard)/templates/page.tsx`. Le problème est donc circonscrit à cette route — mais c'est justement la route qui va grossir.)*

À 51 modèles, le catalogue pèse **~600 Ko de JSON**. Servir ça au navigateur pour afficher une grille de cartes, dont chacune n'a besoin que du titre, de l'icône et d'une phrase, est indéfendable : ce serait le plus gros poste du bundle pour une donnée dont 99 % n'est jamais lue.

### 3.2 L'architecture cible

```
lib/templates/
├── catalog/                       ← SOURCE DE VÉRITÉ, versionnée dans Git
│   ├── _order.json                ← ordre d'affichage imposé (51 slugs)
│   ├── index.json                 ← index léger (37 Ko) — autorisé côté client
│   ├── contact-general.json
│   ├── demande-devis.json
│   └── … (51 fichiers de modèles)
├── types.ts                       ← TemplateDefinition, TemplateIndexEntry
├── generated.ts                   ← AUTO-GÉNÉRÉ · `import 'server-only'` · imports statiques
├── to-form.ts                     ← TemplateDefinition → Form (résolution de langue)
└── seeds.ts                       ← ⚠️ À SUPPRIMER en fin de phase
```

> `CLAUDE.md` fixe `types/` comme source de vérité des types. `lib/templates/types.ts` est une **exception assumée** : ces types décrivent un format de fichier de contenu, pas le modèle de données de l'application. Si vous préférez la règle stricte, déplacez-les dans `types/templates.ts` et ajustez les imports — les deux se défendent, mais tranchez une fois.

**Pourquoi des imports statiques et pas `fs.readFileSync` ?** Le `Dockerfile` produit un build `standalone`. Avec `fs`, il faudrait déclarer `outputFileTracingIncludes` dans `next.config.mjs`, et une erreur de configuration ne se voit qu'en production. Les imports statiques sont résolus par webpack au build : si un fichier manque, **le build échoue**, ce qui est le comportement voulu. Et grâce à `import 'server-only'`, le module ne peut structurellement pas entrer dans un bundle client.

### 3.3 Étapes

#### Étape 2.1 — Prérequis

`server-only` est **déjà** dans `package.json`. `resolveJsonModule` est **déjà** à `true` dans `tsconfig.json`. Il ne manque que `tsx`, installé au correctif 0.2.

#### Étape 2.2 — Créer `lib/templates/types.ts`

```ts
import type { Field, FormSettings, LogicRule, MultilingualText } from '@/types';

/** Faisabilité d'un modèle vis-à-vis des types de champs disponibles. */
export type TemplateFeasibility = 'ready' | 'degraded' | 'blocked';

/** Un champ de catalogue : un `Field` sans les métadonnées liées au formulaire. */
export type TemplateField = Omit<Field, 'form_id' | 'field_order' | 'created_at'>;

/**
 * Une règle de catalogue : une `LogicRule` sans `form_id`.
 * `target_field_id` est explicitement nullable : les règles `end_form` portent `null`,
 * ce que `LogicRule['target_field_id']` (optionnel, non nullable) ne couvre pas.
 */
export type TemplateLogicRule = Omit<LogicRule, 'form_id' | 'target_field_id'> & {
  target_field_id?: string | null;
};

export interface TemplateDefinition {
  id: string;                       // 'tpl-mooove-<slug>'
  slug: string;
  category: string;
  icon: string;                     // nom d'icône Lucide
  display_mode: 'scroll' | 'sections' | 'typeform';
  feasibility: TemplateFeasibility;
  feasibility_note: MultilingualText;
  title: MultilingualText;
  description: MultilingualText;
  template_description: MultilingualText;
  scoring_enabled: boolean;
  show_score_to_respondent: boolean;
  settings: FormSettings;
  fields: TemplateField[];
  logic_rules: TemplateLogicRule[];
}

/** Entrée d'index — tout ce dont la galerie a besoin sans charger le modèle complet. */
export interface TemplateIndexEntry {
  id: string;
  slug: string;
  category: string;
  icon: string;
  display_mode: TemplateDefinition['display_mode'];
  feasibility: TemplateFeasibility;
  title: MultilingualText;
  template_description: MultilingualText;
  scoring_enabled: boolean;
  field_count: number;
  page_count: number;
  rule_count: number;
  has_matrix: boolean;
  has_media: boolean;
  has_file: boolean;
}
```

> `MultilingualText` a la forme `{ fr: string; en?: string; es?: string; [lang: string]: string | undefined }`. Les 51 fichiers du catalogue remplissent systématiquement `fr` **et** `en` ; `es` reste vide.

#### Étape 2.3 — Copier les fichiers JSON

Copier le dossier `catalog/` fourni avec cette spec vers `lib/templates/catalog/` : les 51 fichiers de modèles, plus `index.json` et `_order.json`.

#### Étape 2.4 — Créer `scripts/build-template-catalog.ts`

Ce script régénère `index.json` **et** `generated.ts` à partir des 51 fichiers. Il doit être rejouable à volonté et **produire exactement les mêmes fichiers que ceux livrés** (diff vide au premier passage).

> ⚠️ **L'ordre du catalogue est imposé, pas alphabétique.** Il suit l'ordre des catégories du rail défini en §4.3. Un `readdirSync().sort()` mélangerait les 51 entrées et casserait l'affichage. Le script lit donc `_order.json` et **échoue** si un fichier n'y est pas listé, ou si un slug listé n'a pas de fichier — c'est le garde-fou qui empêche d'oublier un nouveau modèle.

```ts
// scripts/build-template-catalog.ts
// Usage : npx tsx scripts/build-template-catalog.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TemplateDefinition, TemplateIndexEntry } from '../lib/templates/types';

const DIR = join(process.cwd(), 'lib/templates/catalog');
const camel = (s: string) =>
  s.split('-').map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');

// L'ordre vient de _order.json, JAMAIS du système de fichiers.
const { order } = JSON.parse(readFileSync(join(DIR, '_order.json'), 'utf8')) as { order: string[] };
const onDisk = readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== '_order.json')
  .map((f) => f.replace(/\.json$/, ''));

const missing = order.filter((s) => !onDisk.includes(s));
const orphans = onDisk.filter((s) => !order.includes(s));
if (missing.length || orphans.length) {
  console.error('✗ _order.json et le dossier catalog/ divergent.');
  if (missing.length) console.error('  listés sans fichier :', missing.join(', '));
  if (orphans.length) console.error('  fichiers non listés  :', orphans.join(', '));
  process.exit(1);
}

const defs: TemplateDefinition[] = order.map(
  (slug) => JSON.parse(readFileSync(join(DIR, `${slug}.json`), 'utf8')) as TemplateDefinition
);

const index: TemplateIndexEntry[] = defs.map((t) => ({
  id: t.id, slug: t.slug, category: t.category, icon: t.icon,
  display_mode: t.display_mode, feasibility: t.feasibility,
  title: t.title, template_description: t.template_description,
  scoring_enabled: t.scoring_enabled,
  field_count: t.fields.filter((f) => f.type !== 'section_break').length,
  page_count: t.fields.filter((f) => f.type === 'section_break').length,
  rule_count: t.logic_rules.length,
  has_matrix: t.fields.some((f) => f.type === 'matrix'),
  has_media: t.fields.some((f) => f.type === 'image' || f.type === 'video'),
  has_file: t.fields.some((f) => f.type === 'file'),
}));
writeFileSync(join(DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');

const lines = [
  '// AUTO-GÉNÉRÉ par scripts/build-template-catalog.ts — NE PAS ÉDITER À LA MAIN.',
  "import 'server-only';",
  "import type { TemplateDefinition, TemplateIndexEntry } from './types';",
  "import indexJson from './catalog/index.json';",
  '',
  ...defs.map((t) => `import ${camel(t.slug)} from './catalog/${t.slug}.json';`),
  '',
  'export const TEMPLATE_INDEX = indexJson as TemplateIndexEntry[];',
  '',
  'const CATALOG: Record<string, TemplateDefinition> = {',
  ...defs.map((t) => `  '${t.slug}': ${camel(t.slug)} as unknown as TemplateDefinition,`),
  '};',
  '',
  'export function getTemplateDefinition(slug: string): TemplateDefinition | null {',
  '  return CATALOG[slug] ?? null;',
  '}',
  '',
  'export function listTemplateDefinitions(): TemplateDefinition[] {',
  '  return Object.values(CATALOG);',
  '}',
  '',
];
writeFileSync(join(process.cwd(), 'lib/templates/generated.ts'), lines.join('\n'));
console.log(`✓ ${defs.length} modèles · index.json + generated.ts régénérés`);
```

Ajouter dans `package.json` :
```json
"scripts": {
  "templates:build": "tsx scripts/build-template-catalog.ts",
  "templates:check": "tsx scripts/validate-templates.ts"
}
```

#### Étape 2.5 — Créer `scripts/validate-templates.ts`

Un validateur qui **fait échouer le build** si un modèle est invalide. Il doit vérifier, pour chacun des 51 fichiers :

1. `type` ∈ les 18 types autorisés (et rien d'autre).
2. Toutes les clés de `validation` ∈ `FieldValidation`.
3. Identifiants de champs et d'options **uniques à l'intérieur d'un même modèle**, tous préfixés par le `slug`.
4. `label`, `description`, `placeholder` : `fr` **et** `en` présents.
5. `single_choice` / `multiple_choice` ≤ 20 options · `dropdown` ≤ 50 · `matrix` ≤ 20 lignes et ≤ 10 colonnes · libellé de champ ≤ 200 caractères · libellé d'option ≤ 150 (constantes de `lib/constants/limits.ts`).
6. `display_mode: 'sections'` ⇒ le **premier** champ est un `section_break`.
7. `display_mode: 'scroll' | 'typeform'` ⇒ **aucun** `section_break`.
8. Chaque `logic_rules[].conditions[].source_field_id` et chaque `target_field_id` existe dans `fields`.
9. Si le champ source est un `single_choice` / `multiple_choice` / `dropdown`, la `value` de la condition est un **`option_id`**, jamais un libellé.
10. `points` présent uniquement si `scoring_enabled === true`.
11. Les champs `layout_width: 'half'` vont par **paires adjacentes**.
12. `feasibility !== 'ready'` ⇒ `feasibility_note.fr` non vide.
13. `_order.json` et le dossier sont synchrones (même contrôle que le script de build).
14. `index.json` régénéré est **identique** à celui du dépôt — sinon quelqu'un a modifié un `.json` sans relancer `templates:build`.

> Les 51 fichiers fournis passent déjà ces contrôles. Le script sert à protéger les ajouts futurs.

Brancher `npm run templates:check` dans la CI. Ne **pas** l'ajouter en `prebuild` du `Dockerfile` sans vérifier que `tsx` y est disponible — c'est une dépendance de développement, généralement absente de l'image de production.

#### Étape 2.6 — Créer `lib/templates/to-form.ts`

⚠️ **Point d'attention majeur.** `Form.title`, `Form.description`, `Form.template_description` et `Form.template_category` sont des **`string`**, pas des `MultilingualText`. Seuls les libellés de **champs** sont multilingues. La conversion doit donc résoudre la langue.

```ts
import type { Field, Form, LogicRule, MultilingualText } from '@/types';
import type { TemplateDefinition } from './types';

const ml = (m: MultilingualText, lang: string): string => m[lang] ?? m.fr ?? '';

/**
 * Convertit une définition de catalogue en `Form` prêt à être passé à `importForm`.
 * `lang` détermine la langue des textes non multilingues (titre du formulaire, description).
 * Les libellés de champs restent multilingues : le formulaire cloné est bilingue.
 */
export function templateToForm(def: TemplateDefinition, lang: 'fr' | 'en' = 'fr'): Form {
  const now = new Date().toISOString();
  return {
    id: def.id,
    team_id: '',                       // renseigné par importForm
    title: ml(def.title, lang),
    slug: def.slug,
    description: ml(def.description, lang),
    display_mode: def.display_mode,
    status: 'published',
    is_template: true,
    template_origin_id: null,
    scope: 'global',
    template_category: def.category,
    template_description: ml(def.template_description, lang),
    template_icon: def.icon,
    theme: {
      bg: '#EFF9FE',
      accent: '#052139',
      font: 'Aktiv Grotesk',
      bg_type: 'preset',
      bg_preset: 'ice',
    },
    access_type: 'public',
    languages: ['fr', 'en'],
    default_language: lang,
    fields: def.fields.map((f, i) => ({ ...f, form_id: def.id, field_order: i }) as Field),
    logic_rules: def.logic_rules.map((r) => ({ ...r, form_id: def.id }) as LogicRule),
    save_and_resume: true,
    unique_email: false,
    scoring_enabled: def.scoring_enabled,
    show_score_to_respondent: def.show_score_to_respondent,
    settings: def.settings,
    published_at: null,
    closes_at: null,
    created_at: now,
    updated_at: now,
  };
}
```

#### Étape 2.7 — Routes API

**`app/api/templates/route.ts`** — l'index léger.

```ts
import { NextResponse } from 'next/server';
import { TEMPLATE_INDEX } from '@/lib/templates/generated';

export const dynamic = 'force-static';   // l'index ne change qu'au déploiement

export async function GET() {
  return NextResponse.json(TEMPLATE_INDEX, {
    headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
  });
}
```

**`app/api/templates/[slug]/route.ts`** — un modèle complet, à la demande.

```ts
import { NextResponse } from 'next/server';
import { getTemplateDefinition } from '@/lib/templates/generated';

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const def = getTemplateDefinition(params.slug);
  if (!def) return NextResponse.json({ error: 'Modèle introuvable' }, { status: 404 });
  return NextResponse.json(def, {
    headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
  });
}
```

> **Sécurité.** Ces deux routes n'exposent que des données statiques versionnées dans le dépôt — aucune donnée d'utilisateur, aucune requête Supabase, donc aucune surface RLS. Elles peuvent rester accessibles sans authentification, ce qui prépare la Phase 5. Ne **jamais** y ajouter une lecture de `papyrus.forms`.
>
> ⚠️ Le `matcher` de `middleware.ts` couvre tout sauf les fichiers statiques : `/api/templates/*` y passe. Le correctif 0.3 doit avoir été appliqué, sinon un appel non authentifié est redirigé et la recette 2.10 échoue.

#### Étape 2.8 — Adapter `lib/store/templates.ts`

`listTemplatesByScope` doit cesser d'importer `MOOOOVE_TEMPLATES`.

> ⚠️ **Conserver la fonction `cloneTemplate` réécrite en Phase 1.4** dans ce fichier. Le bloc ci-dessous montre ce qui remplace `listTemplatesByScope` et `getTemplate` — il ne décrit pas le contenu total du fichier.

```ts
'use client';

import type { Form, FormScope } from '@/types';

// … cloneTemplate (Phase 1.4) reste ici, inchangé …

/** Les modèles Mooove viennent désormais de /api/templates ; ici on ne trie que le local. */
export function listLocalTemplatesByScope(
  localForms: Form[]
): Record<Exclude<FormScope, 'global'>, Form[]> {
  const personal: Form[] = [];
  const workspace: Form[] = [];
  for (const f of localForms) {
    if (!f.is_template) continue;
    (f.scope === 'workspace' ? workspace : personal).push(f);
  }
  return { personal, workspace };
}

/** Charge un modèle Mooove complet à la demande. */
export async function fetchGlobalTemplate(slug: string): Promise<Form> {
  const res = await fetch(`/api/templates/${slug}`);
  if (!res.ok) throw new Error('Modèle introuvable');
  const def = await res.json();
  const { templateToForm } = await import('@/lib/templates/to-form');
  return templateToForm(def);
}
```

> `to-form.ts` ne doit **pas** contenir `import 'server-only'` — il est appelé côté client. C'est `generated.ts` qui porte le garde-fou.

#### Étape 2.9 — Supprimer `lib/templates/seeds.ts`

Les 6 modèles historiques ont chacun leur successeur dans le catalogue, en version enrichie et bilingue :

| Ancien seed | Nouveau slug |
|---|---|
| `tpl-mooove-nps` | `nps` |
| `tpl-mooove-satisfaction` | `csat-apres-service` |
| `tpl-mooove-brief` | `brief-creatif` |
| `tpl-mooove-event` | `inscription-evenement` |
| `tpl-mooove-candidature` | `candidature-poste` |
| `tpl-mooove-feedback` | `feedback-produit` |

Supprimer le fichier et corriger tous les imports.

#### Étape 2.10 — Recette

- [ ] `npm run templates:check` passe sur les 51 fichiers.
- [ ] `npm run templates:build` régénère `index.json` et `generated.ts` **sans aucun diff** par rapport aux fichiers livrés — l'ordre en particulier.
- [ ] `npm run typecheck && npm run lint && npm run build` passent (rappel `CLAUDE.md` : zéro erreur TypeScript, zéro erreur ESLint, on ne remet pas `ignoreBuildErrors`).
- [ ] **Contrôle de taille du bundle** : relever le First Load JS de `/templates` dans le rapport de build **avant** la Phase 2, puis après. Il doit **baisser**, pas monter. Une valeur qui explose signale que le catalogue est entré dans le chunk client — vérifier alors que `generated.ts` porte bien `import 'server-only'` et qu'aucun composant `'use client'` ne l'importe.
  *(Note : `templates/page.tsx` fait aujourd'hui `import * as Icons from 'lucide-react'` pour résoudre les icônes dynamiquement. C'est un import de barrel qui pèse lourd et qui est un suspect au moins aussi crédible qu'une fuite du catalogue. La Phase 3 doit le remplacer par une table d'icônes explicite, limitée aux ~51 icônes réellement utilisées.)*
- [ ] `curl http://localhost:3000/api/templates | jq length` renvoie `51`.
- [ ] `curl http://localhost:3000/api/templates/quiz-connaissances | jq '.fields | length'` renvoie un nombre.

---

## 4. PHASE 3 — Refondre la page `/templates` 🟠

### 4.1 Limites de la page actuelle

`app/(dashboard)/templates/page.tsx` : 3 onglets, une bande « Vos favoris », une grille plate et une recherche qui couvre déjà titre + `template_description` + `template_category` + `description`. À 6 modèles ça passe. À 51, non — il faut **naviguer par catégorie et filtrer par capacité**, pas faire défiler 51 cartes.

Deux éléments existants à préserver : la **bande Favoris** (lignes 98-118, alimentée par `lib/store/favorites.ts`) et le composant local **`EmptyState`** (ligne 286) — qui devra être extrait vers `components/templates/` puisque `page.tsx` devient un Server Component.

### 4.2 Structure cible

```
app/(dashboard)/templates/
├── page.tsx                       ← Server Component : charge TEMPLATE_INDEX, passe en props
└── TemplateGallery.tsx            ← Client Component : filtres, recherche, grille
components/templates/
├── TemplateCard.tsx
├── TemplateFilters.tsx            ← filtres secondaires
├── TemplatePreviewDrawer.tsx      ← panneau latéral, remplace la PreviewModal
├── CategoryRail.tsx               ← rail de catégories, sticky
├── TemplateEmptyState.tsx         ← extrait de l'actuel page.tsx:286
└── template-icons.ts              ← table explicite slug → composant Lucide
```

> `CLAUDE.md` liste `components/ builder · public · respondent · ui · layout`. `components/templates/` est un sixième dossier : **mettre à jour `CLAUDE.md` en conséquence** dans le même commit, pour que la règle reste vraie.

> `template-icons.ts` remplace le `import * as Icons from 'lucide-react'` actuel. Importer nommément les ~51 icônes utilisées et les exposer dans un `Record<string, LucideIcon>`. C'est ce qui évite d'embarquer le barrel entier dans le chunk client.

`page.tsx` (Server Component) :

```tsx
import { TEMPLATE_INDEX } from '@/lib/templates/generated';
import { TemplateGallery } from './TemplateGallery';

export const metadata = { title: 'Modèles · Papyrus' };

export default function TemplatesPage() {
  return <TemplateGallery index={TEMPLATE_INDEX} />;
}
```

> L'index (37 Ko) est sérialisé dans le flux RSC. C'est acceptable et évite un aller-retour au chargement. Le modèle **complet** n'est chargé qu'à l'ouverture de l'aperçu ou au clic sur « Utiliser ».

### 4.3 Spécification UI/UX

Rappel `CLAUDE.md` : couleurs **via les tokens CSS de `app/globals.css`**, jamais en dur. Dosage 75 % Navy + blanc · 15 % Cyan · 5 % Blue & Sky · 5 % Ambre. **Jamais d'Ambre et de Cyan dans le même bloc visuel.** Coins : `rounded` 8 px (inputs, badges) · `rounded-xl` 12 px (boutons, panneaux) · `rounded-2xl` 20 px (cards). Typographie : une seule famille, deux poids, titres en Bold.

#### En-tête
- Titre `Modèles` en `font-display text-4xl`.
- Sous-titre : *« 50 modèles prêts à l'emploi, en français et en anglais. »* (50 et non 51 : `bon-de-commande` n'est pas publié — cf. plus bas.)
- Barre de recherche à droite. Le comportement actuel (titre + `template_description` + `template_category` + `description`) est **conservé tel quel** ; l'index fournit les trois premiers. L'extension aux **libellés de champs** est un ajout optionnel qui demanderait un index de recherche séparé — la traiter en Phase 3 bis, seulement si le besoin se confirme à l'usage.

#### Rail de catégories (`CategoryRail`)
- Pastilles horizontales défilantes, sticky sous l'en-tête.
- Ordre imposé : `Toutes` · Contact & Leads · RH & Recrutement · Vie interne · Satisfaction client · Produit & Recherche · Événements · Marketing & Agence · Réservations & Voyage · Éducation & Quiz · Opérations & Conformité.
- Compteur discret dans chaque pastille.
- Pastille active : fond `--mooove-navy`, texte `--mooove-ice`. Inactive : bordure `--border`, texte `--text-secondary`.

#### Filtres secondaires (`TemplateFilters`)
Une rangée de bascules, toutes cumulables :
`Avec logique conditionnelle` · `Formulaire noté` · `Avec matrice` · `Avec image ou vidéo` · `Avec pièce jointe` · `Une question à la fois`
Chacune se lit directement dans `TemplateIndexEntry` (`rule_count > 0`, `scoring_enabled`, `has_matrix`, `has_media`, `has_file`, `display_mode === 'typeform'`).

#### Carte (`TemplateCard`)
`rounded-2xl`, bordure `--border`, fond `--bg-surface`. Au survol : `--border-strong` + `shadow-sm` + translation de −2 px.

- Icône Lucide résolue depuis `entry.icon` **via `template-icons.ts`** (pas via le barrel), dans un carré `rounded-xl` de 40 px, fond `--bg-elevated`.
- Étoile favori en haut à droite (`lib/store/favorites.ts`).
  > ⚠️ **Conflit de charte à trancher.** L'étoile active est aujourd'hui `fill-mooove-amber`, et le bouton `Utiliser` utilise `var(--accent)` — qui vaut `#052139` en mode clair mais **`#2AC2DE` en mode sombre** (`app/globals.css` ligne ~113). En mode sombre, la carte contient donc de l'Ambre **et** du Cyan, ce que `CLAUDE.md` interdit explicitement dans un même bloc visuel.
  > **Correction : passer l'étoile favori sur `--mooove-electric` (`#3C5EAB`)**, qui appartient à la charte, se lit bien sur les deux fonds, et ne crée pas la paire interdite.
- Titre `font-display text-lg`.
- `template_description` en `papyrus-meta text-xs`.
- Rangée de badges en pied de carte : nombre de champs · mode d'affichage · `Logique` si `rule_count > 0` · `Noté` si `scoring_enabled` · `Média` si `has_media`.
- Deux boutons : `Voir` (ouvre le tiroir) et `Utiliser` (fond `var(--accent)`).

> ⚠️ Ne **pas** afficher le badge de faisabilité (`ready` / `degraded` / `blocked`) dans l'application. C'est une information de pilotage interne, présente dans la galerie HTML de référence. L'utilisateur final n'a pas à savoir qu'un champ manque.
> **Corollaire : ne pas publier le modèle `bon-de-commande` (`feasibility: 'blocked'`) tant que la Phase 4 n'est pas faite.** Filtrer sur `feasibility !== 'blocked'` dans `TEMPLATE_INDEX` au moment du rendu. Cela laisse **50 modèles** visibles sur 51.

#### Bande Favoris
Conservée à l'identique au-dessus du rail de catégories, visible seulement s'il y a au moins un favori. Elle agrège les favoris des trois onglets, comme aujourd'hui.

#### Tiroir d'aperçu (`TemplatePreviewDrawer`)
Remplace `PreviewModal` sur cette page. Panneau latéral droit, `max-w-2xl`, entrée par translation (Framer Motion, 260 ms, `cubic-bezier(.4,0,.2,1)`).
- Charge le modèle complet via `GET /api/templates/[slug]` à l'ouverture, avec un état de chargement en squelette.
- Affiche la structure : pages, champs, types, options, règles de logique — la galerie HTML fournie est la référence visuelle exacte de ce rendu.
- Bouton `Utiliser ce modèle` fixé en pied de tiroir.

#### États vides
- Recherche sans résultat : réutiliser l'`EmptyState` existant.
- Onglet « Mes modèles » vide : message actuel conservé.

### 4.4 Onglets

Conserver les 3 onglets (`Mes modèles` / `Modèles de l'équipe` / `Modèles Mooove`), **mais** :
- L'onglet par défaut devient `Modèles Mooove` (déjà le cas).
- Le rail de catégories et les filtres secondaires ne s'affichent que sur l'onglet `Modèles Mooove`.
- Les onglets `personal` et `workspace` gardent la grille plate actuelle, alimentée par `listLocalTemplatesByScope`.

### 4.5 Recette

- [ ] 50 modèles visibles sur l'onglet Mooove (51 moins `bon-de-commande`).
- [ ] Chaque pastille de catégorie filtre correctement et son compteur est juste.
- [ ] Les filtres secondaires se cumulent.
- [ ] L'aperçu affiche la logique conditionnelle et les points de scoring.
- [ ] `Utiliser` mène au builder avec **la logique et le scoring intacts** (cela valide la Phase 1 de bout en bout).
- [ ] Les favoris continuent de fonctionner sur les modèles globaux, et la bande Favoris s'affiche.
- [ ] Aucune couleur en dur : `grep -rn "#052139\|#2AC2DE\|#F6923E\|#3C5EAB" components/templates/ app/\(dashboard\)/templates/` ne renvoie rien.
- [ ] En **mode sombre**, aucune carte ne présente simultanément de l'Ambre et du Cyan.
- [ ] Le First Load JS de `/templates` a baissé par rapport à la mesure d'avant Phase 2.

---

## 5. PHASE 4 — Nouveaux types de champs 🟢

### 5.1 Priorisation

| # | Type | Débloque | Complexité | Priorité |
|---|---|---|---|---|
| 1 | `time` | 3 modèles (rendez-vous, restaurant, transfert) | Faible | **P0** |
| 2 | `consent` | Consentement RGPD, CGU — partout | Faible | **P0** |
| 3 | `hidden` + préremplissage URL | Attribution marketing, liens CRM | Moyenne | **P0** |
| 4 | `signature` | Consentement, décharge, contrat | Moyenne | **P1** |
| 5 | `address` | Livraison, facturation | Faible | **P1** |
| 6 | `ranking` | Enquêtes de priorisation | Moyenne | **P2** |
| 7 | `calculated` | Devis, totaux, calculateurs | Élevée | **P2** |
| 8 | `payment` | Bon de commande, dons, billetterie | Élevée | **P2** |

### 5.2 Checklist d'impact — à appliquer pour CHAQUE nouveau type

Ajouter un type de champ touche **14 endroits**. En oublier un produit un bug silencieux en production (typiquement : le champ fonctionne dans le builder mais la réponse n'apparaît pas dans l'export).

1. `types/index.ts` → ajouter à l'union `FieldType`, et les clés nécessaires à `FieldValidation`.
2. `supabase/migrations/00X_….sql` → **modifier la contrainte `CHECK`** de `papyrus.fields.type`. Sans ça, l'insertion échoue en base :
   ```sql
   alter table papyrus.fields drop constraint if exists fields_type_check;
   alter table papyrus.fields add constraint fields_type_check check (type in (
     'short_text','long_text','email','phone','number','url',
     'single_choice','multiple_choice','dropdown','rating','nps',
     'date','file','section_break','statement','image','video','matrix',
     'time','consent','hidden','signature','address','ranking','calculated','payment'
   ));
   ```
   Migration **idempotente**, dans `supabase/migrations/` uniquement (règle `CLAUDE.md`).
3. `lib/field-meta.ts` → entrée dans `FIELD_META` (label, icône Lucide, description, `hasOptions`, `hasPlaceholder`) **et** rattachement à une famille dans `FIELD_CATEGORIES` — sans quoi le type n'apparaît pas dans la palette (c'est exactement le bug de `number`, correctif 0.1).
4. `lib/field-icons.ts` → `getFieldIcon` / `isIconVisible`. **Deuxième table d'icônes, distincte de `FIELD_META`**, consommée par `PreviewModal.tsx`. Facile à oublier.
5. `lib/store/supabase-forms.ts` → fonction `addField()` (~ligne 380) : le `switch` par type qui construit les `options`, `rows` et `validation` par défaut à la création depuis la palette. Sans entrée, le nouveau champ naît vide.
6. `components/builder/FieldRenderer.tsx` → rendu dans le builder.
7. `components/builder/FieldSettings.tsx` → panneau de réglages.
8. `components/public/PublicFieldCard.tsx` → rendu côté répondant.
9. `lib/validation/form-validation.ts` → validation côté client.
10. `app/api/submit/[slug]/route.ts` → **validation côté serveur** (la validation client ne protège rien).
11. `lib/submission-columns.ts` + `lib/submission-format.ts` → colonnes du tableau de réponses et formatage.
12. `lib/pdf/submission-pdf.ts` → rendu dans le PDF récapitulatif.
13. `lib/chart-selector.ts` → graphique par défaut sur le tableau de bord (ou exclusion explicite).
14. `lib/logic-evaluation.ts` → `evaluateSingleCondition`, si le type peut servir de source à une règle de logique.

Et si le champ peut être noté : `lib/scoring.ts`, fonction `calculateFieldScore`.

### 5.3 Spécifications par type

#### `time` — P0
- `validation` : `{ min?: string; max?: string; step_minutes?: 5|10|15|30|60 }` (`min`/`max` au format `"HH:MM"`).
- Rendu : `<input type="time">` natif, plus une liste de créneaux quand `step_minutes` est défini.
- Stockage : chaîne `"HH:MM"`. Pas de fuseau — un créneau de rendez-vous est local par nature.
- Après livraison : **repasser les modèles `prise-rendez-vous`, `reservation-restaurant` et `transfert-aeroport` de `degraded` à `ready`**, et remplacer leur `dropdown` de créneaux par un vrai champ `time`.

#### `consent` — P0
- Case à cocher unique. `validation` : `{ consent_text: MultilingualText; link_url?: string; link_label?: MultilingualText }`.
- `required: true` signifie que la case **doit** être cochée pour soumettre — c'est ce qui le distingue d'un `single_choice` Oui/Non.
- Stockage : `boolean`. Conserver l'horodatage de soumission comme preuve.

#### `hidden` + préremplissage par URL — P0
- `validation` : `{ query_param: string; default_value?: string }`.
- Le champ n'est jamais affiché ; il lit `?utm_source=…` sur la page publique.
- 🔐 **Sécurité — impératif.** Un champ caché est fourni par le client : il est **manipulable par n'importe qui**. Règles :
  - Ne **jamais** faire dépendre un prix, un droit d'accès ou une décision serveur de la valeur d'un champ caché.
  - Dans `/api/submit/[slug]`, n'accepter que les `query_param` **déclarés dans la définition du formulaire** (liste blanche) ; ignorer toute clé inconnue.
  - Limiter chaque valeur à 200 caractères et échapper à l'affichage — c'est un vecteur d'injection classique dans les exports CSV.
- Ajouter un préremplissage générique : `?champ_<field_id>=valeur` pour n'importe quel champ texte, avec la même liste blanche.

#### `signature` — P1
- Capture au doigt / à la souris sur `<canvas>`, export PNG.
- 🔐 **Stockage : Cloudflare R2, via `lib/storage/attachments-client.ts`.** Règle non négociable de `CLAUDE.md` : jamais de data URL en base, jamais Supabase Storage pour un média. Stocker en base uniquement l'URL R2.
- Pour la valeur probante, enregistrer avec la soumission : URL R2, horodatage serveur, `ip_hash` (déjà calculé par `/api/submit/[slug]`), et le `user_agent`.
- Après livraison : repasser `consentement-rgpd-image` de `degraded` à `ready`.

#### `address` — P1
- Champ composite. Sous-valeurs : `line1`, `line2`, `city`, `postal_code`, `country`, plus `state` optionnel.
- `validation` : `{ default_country?: string; require_state?: boolean; countries_allowlist?: string[] }`.
- Réutiliser `lib/constants/countries.ts`, déjà présent.
- Stockage : objet JSON. `lib/submission-columns.ts` doit produire **une colonne par sous-valeur** (`[field_id]__city`, etc.) pour que l'export Google Sheets reste exploitable.

#### `ranking` — P2
- Glisser-déposer avec **@dnd-kit**, déjà une dépendance du projet.
- Stockage : tableau ordonné d'`option_id`.
- Scoring : points = position inversée. À câbler dans `lib/scoring.ts`.
- Accessibilité : prévoir des boutons monter / descendre en secours du glisser-déposer.

#### `calculated` — P2
- `validation` : `{ formula: string; decimals?: number; unit?: string }`.
- 🔐 **Ne jamais évaluer la formule avec `eval()` ni `new Function()`.** Utiliser un évaluateur d'expressions cloisonné — `expr-eval` est un bon choix, léger et sans accès au contexte global. Une formule est de la donnée fournie par un utilisateur du produit ; l'exécuter comme du JavaScript, c'est une exécution de code arbitraire côté client, et côté serveur si le recalcul y est fait.
- Syntaxe : références par identifiant de champ, `{champ_id} * 1.15`.
- **Recalculer systématiquement côté serveur** dans `/api/submit/[slug]` : la valeur envoyée par le client n'est qu'un affichage.

#### `payment` — P2
- 🔐 **Périmètre à valider par la direction avant développement.** Encaisser des paiements engage l'entreprise sur le plan contractuel, fiscal et réglementaire (PCI-DSS, SCA/3-D Secure, remboursements, litiges). Ce n'est pas une décision technique.
- **Implémentation obligatoire : Stripe Checkout ou Stripe Elements.** Aucune donnée de carte ne doit jamais transiter par un serveur Papyrus — c'est ce qui maintient le projet hors du périmètre PCI lourd.
- 🔐 `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` : onglet **Environment** du service Easypanel, valeurs issues de **Vaultwarden `MOOOVE IT`**, lues **exclusivement via `lib/env.ts`**. Jamais dans le dépôt. **Jamais de préfixe `NEXT_PUBLIC_`** sur ces deux clés — elles seraient inlinées dans le bundle navigateur. Seule `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` est publique, c'est sa nature.
- Le montant fait **autorité côté serveur**. Il est recalculé à partir de la définition du formulaire à la création de la session Stripe. Ne jamais faire confiance à un montant envoyé par le navigateur.
- La soumission n'est marquée payée que par le **webhook Stripe**, dont la signature doit être vérifiée. Pas par une redirection de succès, qui est falsifiable.
- Chaque compte Papyrus doit brancher **son propre** compte Stripe (Stripe Connect, ou une clé par espace de travail chiffrée comme le jeton Google l'est déjà dans la migration 002). Ne jamais mutualiser un compte Stripe entre clients.
- Après livraison : repasser `bon-de-commande` de `blocked` à `ready` et le publier.

### 5.4 Après chaque type livré

1. Mettre à jour les modèles concernés dans `lib/templates/catalog/`.
2. Passer `feasibility` à `'ready'` et vider `feasibility_note`.
3. `npm run templates:build && npm run templates:check`.
4. Ajouter le nouveau type à la liste blanche du validateur.
5. Vérifier le parcours complet : builder → aperçu → publication → réponse → tableau de réponses → export CSV → export Google Sheets → PDF.

---

## 6. PHASE 5 — Page publique SEO `/modeles` 🟢

### 6.1 Pourquoi

`tally.so/templates` et `jotform.com/form-templates` sont les premières sources d'acquisition organique de ces produits. Une page publique indexable, une URL par modèle, est le meilleur rapport effort / acquisition du projet.

### 6.2 Structure

```
app/modeles/
├── page.tsx                       ← liste, statique, ISR 24 h
└── [slug]/page.tsx                ← une page par modèle, generateStaticParams sur les 50 publiés
```

- `generateStaticParams()` depuis `TEMPLATE_INDEX`, filtré sur `feasibility !== 'blocked'` → 50 pages statiques.
- `generateMetadata()` par modèle : `title`, `description`, Open Graph, `alternates.languages` pour FR/EN.
- Balisage `schema.org/HowTo` ou `SoftwareApplication` sur chaque page.
- CTA : `Utiliser ce modèle` → `/signup?template=<slug>`, puis clonage automatique après création du compte.
- `sitemap.ts` incluant les 50 URL publiées.

### 6.3 Sécurité

🔐 `middleware.ts` protège actuellement l'application. Ajouter `/modeles` à la liste blanche des chemins publics, **de façon explicite et limitée**.

- Ne **jamais** élargir une règle existante ni ajouter un motif large du type `/mod*`.
- Rappel `CLAUDE.md` — **ne pas réintroduire un « mode local »** : l'ancien `NEXT_PUBLIC_LOCAL_MODE` désactivait l'authentification dans le middleware, et une variable mal renseignée suffisait à publier l'application entière. Une entrée de liste blanche codée en dur est la seule forme acceptable.
- Ces pages ne lisent que le catalogue en code. **Aucune requête Supabase, aucune donnée d'utilisateur, aucun `createAdminClient()`.**
- Vérifier après déploiement : `curl -I https://<domaine>/dashboard` en session anonyme doit toujours rediriger vers la connexion.

---

## 7. Le catalogue livré

### 7.1 Répartition

L'ordre de ce tableau est celui de `_order.json` et du rail de catégories.

| Catégorie | Modèles | Dont notés | Modèles avec logique | Règles |
|---|---|---|---|---|
| Contact & Leads | 5 | — | 1 | 2 |
| RH & Recrutement | 6 | 2 | 2 | 3 |
| Vie interne | 5 | — | 2 | 2 |
| Satisfaction client | 5 | — | 3 | 4 |
| Produit & Recherche | 6 | — | 4 | 6 |
| Événements | 5 | — | 1 | 3 |
| Marketing & Agence | 5 | — | 1 | 2 |
| Réservations & Voyage | 5 | — | 1 | 2 |
| Éducation & Quiz | 5 | 2 | 1 | 2 |
| Opérations & Conformité | 4 | — | 2 | 4 |
| **Total** | **51** | **4** | **18** | **30** |

**608 blocs de champ**, soit **499 questions** et **109 `section_break`** (les sauts de page).
Modes : 35 en `sections`, 10 en `typeform`, 6 en `scroll`.
Fréquence par type : `single_choice` (106), `long_text` (83), `short_text` (80), `dropdown` (43), `email` (36), `multiple_choice` (26), `date` (24), `file` (17), `number` (16), `nps` (15), `phone` (13), `statement` (11), `matrix` (10), `url` (7), `image` (5), `rating` (4), `video` (3) — plus les 109 `section_break`.

### 7.2 Méthode de constitution

Les catalogues de Tally, Jotform, Microsoft Forms et 123FormBuilder ont été relevés et fusionnés. Ils contiennent énormément de doublons : 123FormBuilder annonce plus de 500 « Registration Forms » qui sont, pour l'essentiel, le même formulaire décliné par secteur. Le catalogue Papyrus retient **un modèle par intention réelle**, structuré par département plutôt que par secteur d'activité — plus dense, plus rapide à parcourir, et il reste utile aux quatre marques du groupe (MeetYourJob et CareerHub sur le pôle RH & Recrutement, SmartTraveller sur Réservations & Voyage, Mooove sur Marketing & Agence).

Le catalogue exploite délibérément ce que les concurrents gratuits n'ont pas : **10 matrices Likert**, **4 formulaires notés** avec niveaux de maturité, **10 formulaires en mode une-question-à-la-fois**, et **8 blocs image ou vidéo en mode créateur** (vidéo d'accueil d'onboarding, teaser d'intervenant, démo produit) — précisément les capacités qui distinguent Papyrus de Google Forms et de Microsoft Forms.

Ce qui a été délibérément écarté : les déclinaisons sectorielles d'un même formulaire, les modèles purement décoratifs, les formulaires à moins de 4 champs, et les catégories entièrement dépendantes du paiement.

### 7.3 Modèles à surveiller

| Slug | Statut | Ce qu'il faut savoir |
|---|---|---|
| `bon-de-commande` | 🔴 `blocked` | **Ne pas publier** avant le champ paiement. Filtré au rendu en Phase 3. |
| `prise-rendez-vous` | 🟠 `degraded` | Créneaux en liste figée. À reprendre après le champ `time`. |
| `reservation-restaurant` | 🟠 `degraded` | Idem. |
| `transfert-aeroport` | 🟠 `degraded` | Idem. |
| `consentement-rgpd-image` | 🟠 `degraded` | Nom tapé au lieu d'une signature. À reprendre après le champ `signature`. Vérifier le texte de consentement avec un juriste avant publication — la mention fournie est un point de départ, pas un avis juridique. |
| `demande-conge` | 🟠 `degraded` | Nombre de jours saisi à la main. À reprendre après le champ calculé. |
| `note-de-frais` | 🟠 `degraded` | Une ligne de dépense par soumission. À reprendre après le groupe répétable. |
| `qualification-lead-b2b` | 🟠 `degraded` | Pas de capture UTM. À reprendre après le champ `hidden`. |
| `quiz-connaissances` | ✅ `ready` | Contenu RGPD à jour et vérifiable, mais **à faire relire** avant publication comme modèle officiel. |

---

## 8. Hors périmètre

Explicitement **non** couvert par cette spécification, à traiter séparément :

- Destination **n8n / webhook** et destination **Airtable** (`FormDestination` existe déjà dans `types/index.ts` mais n'est pas implémentée).
- Notifications **Brevo** en remplacement du transport email actuel.
- Statistiques d'usage des modèles (« les plus utilisés ») — nécessite une table `papyrus.template_usage` et une décision produit.
- Traduction automatique des modèles vers l'espagnol via l'API Claude (`lib/ai/provider.ts` existe).
- Vignettes visuelles par modèle (aperçu image) — nécessite un pipeline de génération et du stockage R2.

---

## 9. Résumé des décisions à valider par Keven avant développement

1. **Champ paiement (Phase 4, #8)** — engage l'entreprise sur les plans contractuel, fiscal et réglementaire. Décision direction, pas décision technique.
2. **Page publique `/modeles` (Phase 5)** — ouvre une surface publique sur l'application. Modification du `middleware.ts` à faire relire.
3. **Modèle `consentement-rgpd-image`** — le texte de consentement fourni doit être relu par un juriste avant d'être publié comme modèle officiel Mooove.
4. **Suppression de `lib/templates/seeds.ts`** — si des formulaires en production ont été créés depuis ces 6 modèles, vérifier qu'aucun code ne résout encore `template_origin_id` vers `tpl-mooove-nps` et consorts. *(En pratique, le bug de la §2.1 rend ce cas improbable : le clonage d'un modèle global échoue aujourd'hui.)*
5. **Le champ `number` absent de la palette (correctif 0.1)** — c'est un bug de production existant, pas une régression de ce chantier. À confirmer avant de le corriger : personne ne s'appuie sur le fait qu'il soit masqué.
