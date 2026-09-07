# Papyrus — Plan d'évolution

Objectif : porter dans Papyrus toutes les fonctionnalités de **mooove-invoice**, en
ajoutant la notion de **Projet** (un projet contient plusieurs formulaires), en
passant sur la dernière version de la stack, et en pilotant l'ensemble par une IA
qui construit réellement — jamais par du JSON brut.

Décidé le 07/09/2026. Ce fichier est la référence : toute déviation se discute
avant d'être codée.

---

## 0. Règles du jeu

**Intouchable.** `mooove-invoice`, `mooove.club`, les workflows n8n, l'API
`/api/submissions/[projectToken]` et le token `INVOICE_API_TOKEN`. Aucune ligne
de code, aucune variable, aucune table partagée. Papyrus réimplémente ; il
n'emprunte pas.

**Libre.** Tout Papyrus. Aucun utilisateur, aucune donnée en production : le
schéma, les routes et le modèle de champ peuvent être cassés sans précaution.

**Hors périmètre pour l'instant.** La migration des données mooove-invoice, la
mise hors service de mooove-invoice, l'encaissement de paiements (Stripe / MIPS /
Peach) — mooove-invoice ne l'a jamais fait non plus.

---

## 1. Architecture cible

### 1.1 Hiérarchie

```
Team (espace de travail)
└── Project                      ← nouvelle couche
    ├── Forms (1..n)             ← ce que Papyrus appelle « formulaire » aujourd'hui
    ├── Partners                 ← participation d'un partenaire à ce projet
    ├── Contacts
    ├── Records (agrégés)
    └── Settings (marque, numérotation, modules actifs)
```

### 1.2 À quel niveau vit chaque module

Le critère est simple : **une configuration qui référence des champs appartient
au formulaire ; tout le reste appartient au projet.**

| Module | Niveau | Pourquoi |
| --- | --- | --- |
| Thème, langues, marque | Projet (surchargeable par formulaire) | cohérence entre les formulaires d'un même projet |
| Numérotation des factures | Projet | une séquence par événement / client |
| Partenaires, landing, commissions | Projet | un partenaire promeut un projet, pas un champ |
| Contacts | Projet (+ vue globale) | |
| Champs, sections, logique | Formulaire | |
| Tarification | Formulaire (devise/TVA héritées du projet) | les prix référencent les options d'un formulaire |
| E-mails conditionnels | Formulaire | les conditions référencent des champs |
| Partage, embed, QR | Formulaire | |
| Réponses (Records) | Formulaire (vue projet agrégée) | |
| Intégrations (Sheets) | Formulaire | le mapping référence des champs |

### 1.3 Navigation

```
/projects                          liste des projets — « Nouveau projet »
/projects/[id]                     Forms · Records · Partners · Insights · Settings
/projects/[id]/forms/[formId]      Setup · Records · Insights · Share
                                   └ Setup : Build · Design · Pricing · Email · Integrations · Settings
```

Les URL publiques ne bougent pas : `/f/[slug]`, `/embed/[slug]`.
Nouvelles URL publiques : `/a/[code]` (landing partenaire), `/p/[token]` (portail
partenaire).

### 1.4 Base de données (schéma `papyrus`)

Nouvelles tables : `projects`, `sections`, `partners`, `project_partners`,
`partner_clicks`, `contacts`, `form_versions`, `ai_conversations`, `ai_messages`.

Colonnes ajoutées :

- `forms.project_id` (not null), `forms.pricing_config`, `forms.email_config`,
  `forms.confirmation_config`
- `fields.section_id` (not null) — remplace le pseudo-champ `section_break`
- `fields.visibility` jsonb — conditions par champ, à la mooove-invoice
- `fields.pricing` jsonb — `count_in_total`, prix par option, compteurs de quantité
- `fields.repeater` / `fields.calc` jsonb
- `fields.type` — check étendu aux 10 nouveaux types
- `submissions` — `invoice_number`, `pricing` (instantané), `status`,
  `project_partner_id`, `commission_paid_at`

**Invariants conservés** : RLS par commande (jamais `for all`), aucune policy
`INSERT` sur `submissions`, toute route en `service_role` vérifie elle-même les
droits, médias sur R2 (jamais de data URL — mooove-invoice en abuse, on ne le
reproduit pas).

### 1.5 Stack

| | Avant | Après |
| --- | --- | --- |
| Next.js | 14.2.13 | 16.3 |
| React | 18.3 | 19.2 |
| TypeScript | 5.6 | 7.0 |
| Tailwind | 3.4 | 4.3 (config CSS-first) |
| ESLint | 8.57 | 10 (flat config) |
| Zod | 3.23 | 4.5 |
| supabase-js / ssr | 2.45 / 0.5 | 2.115 / 0.12 |
| Recharts | 2.12 | 3.10 |
| Framer Motion | 11.5 | 13.2 |
| — | — | `openai` 7.10 (nouveau) |

Les trois montées cassantes : **Tailwind 4** (les tokens passent en `@theme`),
**Recharts 3**, **Framer Motion 13**. TypeScript 7 est une majeure : elle
remontera probablement des erreurs nouvelles sur 40 000 lignes.

---

## 2. Architecture IA

**Aucun JSON brut.** La route `/api/generate-form` et le passage par OpenRouter
sont supprimés. L'IA n'écrit jamais un schéma : elle appelle des outils.

### 2.1 Couche outils — `lib/ai/tools/`

Une trentaine d'opérations typées, validées par Zod, exécutées comme **action
serveur au nom de l'utilisateur connecté**, donc sous RLS. L'IA ne touche jamais
la base.

| Famille | Outils |
| --- | --- |
| Projet | `create_project`, `set_project_modules`, `set_branding` |
| Formulaire | `create_form`, `rename_form`, `apply_template` |
| Structure | `add_section`, `update_section`, `move_section`, `delete_section` |
| Champs | `add_field`, `update_field`, `set_options`, `set_validation`, `set_visibility`, `move_field`, `delete_field` |
| Logique | `add_logic_rule`, `delete_logic_rule` |
| Tarification | `enable_pricing`, `set_currency_vat`, `price_option`, `add_discount_code`, `set_tiers` |
| E-mail | `set_email_default`, `add_email_rule` |
| Partenaires | `enable_partners`, `create_partner`, `link_partner_to_project` |
| Intégrations | `connect_sheet`, `map_columns` |

### 2.2 Orchestrateur — `lib/ai/agent.ts`

API Responses d'OpenAI, function calling, réponse en flux. Modèle par défaut
**`gpt-5.6-terra`** (vérifié disponible sur la clé du compte, aux côtés de
`gpt-5.6-sol` et `gpt-5.6-luna`), configurable dans les réglages. Chaque tour est
borné en nombre d'appels d'outils, et **chaque lot est encapsulé dans un
instantané `form_versions`** : une seule action pour tout annuler.

### 2.3 Surfaces

1. **Assistant de création** — « Nouveau projet » ouvre un questionnaire :
   nom → type (enquête · inscriptions & abonnements · bon de commande &
   facturation · candidature · quiz noté · satisfaction / NPS · invitation
   événement · autre) → modules (Tarification ? Partenaires ? Facturation ?
   Google Sheets ?). **« Passer — je construis moi-même »** sur chaque écran.
2. **Panneau de conversation** — ancré dans le builder : on décrit, on regarde
   construire, on annule si besoin.
3. **Voix** — `gpt-realtime-2.1` en WebRTC (jeton de session éphémère émis côté
   serveur, la clé ne quitte jamais le serveur), `gpt-transcribe` en repli.
4. **Import de document** — PDF / DOCX / TXT continue de fonctionner, mais
   alimente le planificateur au lieu d'un parseur JSON.

---

## 3. Phases

Chaque phase se termine par : migration + types + actions serveur + UI + tests,
`npm run verify` au vert, push sur `master`.

**0 — Stack et fondations.** Montée de version complète, Tailwind 4, flat config
ESLint. Ajout de vitest + playwright et d'un script `verify`
(typecheck + lint + test + build). Livrable : l'application à l'identique, build
vert, filet de tests en place.

**1 — Projets, sections, navigation.** Tables `projects` / `sections`,
`forms.project_id`, `fields.section_id`, suppression du type `section_break`.
Nouvelles routes et onglets. « Nouveau formulaire » devient « Nouveau projet ».
Port de `form_versions` (l'annulation IA en dépend). Régénération du catalogue de
modèles. Livrable : un projet contient plusieurs formulaires.

**2 — Parité des champs et visibilité.** Dix nouveaux types : `currency`,
`repeater`, `calculated`, `signature`, `address`, `country`, `yesno`, `link`,
`hidden`, `divider`. `fields.visibility` par champ et par section, à côté de
`logic_rules` pour les sauts. Éditeur de conditions dans le builder. Livrable :
parité avec mooove-invoice, sans rien perdre de Papyrus (matrice, NPS, notation,
vidéo).

**3 — Tarification.** Devise, TVA, codes de réduction, tarifs dégressifs /
early-bird, prix par option, compteurs de quantité, `count_in_total`. Totaux en
direct sur le formulaire public, instantané figé à l'envoi. Onglet Pricing.

**4 — E-mails et facturation.** Règles d'e-mail conditionnelles, bilingue,
`{{jetons}}`, éditeur riche, pièce jointe PDF. Numérotation de facture par projet
(séquence sans course critique). Génération PDF. Écran de confirmation
configurable.

**5 — Records, Insights, Share, Integrations.** Workflow de statut, filtres, PDF
par réponse, export XLSX en masse, resynchronisation. Vue Records agrégée au
niveau projet. Répartition Sheets par valeur de champ vers plusieurs onglets.
Insights enrichis des indicateurs de tarification.

**6 — Partenaires et contacts.** Annuaire au niveau équipe, participation par
projet, code de partage, landing, portail, lien d'auto-inscription, suivi des
commissions. Contacts et export. **Authentification partenaire via Supabase Auth
(rôle `partner`)**, pas de second magasin d'identifiants.

**7 — Couche IA.** Réglages (clé chiffrée, modèle, budget), couche outils,
orchestrateur, assistant de création, panneau de conversation. Suppression de
`/api/generate-form` et d'OpenRouter.

**8 — Voix et durcissement.** Realtime en WebRTC, revue RLS de chaque nouvelle
table, audit des routes `service_role`, couverture Playwright du formulaire
public, de la tarification et du parcours partenaire.

---

## 4. Décisions prises

- **Partenaires sur Supabase Auth** (rôle `partner`) plutôt que le couple
  `username` / `passwordHash` de mooove-invoice. Un second magasin
  d'identifiants viderait la RLS de son sens.
- **Tailwind 4 en phase 0.** C'est le seul moment où la migration est peu coûteuse.
- **Les URL publiques ne changent pas.** Renommer `/f/[slug]` ne rapporterait rien
  et casserait les embeds.
- **`form_versions` porté dès la phase 1**, avant l'IA : sans historique, une
  construction par IA n'est pas annulable.
- **Pas d'encaissement de paiement.** Jamais demandé, absent de mooove-invoice.

## 5. Risques

- Le catalogue de modèles (~600 Ko auto-générés) doit être régénéré et revalidé
  après les phases 1 et 2.
- Le rendu public est touché en phases 1, 2 et 3 : ces phases se font en série,
  jamais en parallèle.
- TypeScript 7 et Tailwind 4 peuvent remonter beaucoup d'erreurs d'un coup en
  phase 0 — c'est le but de la faire en premier, à vide.
- Le coût des appels `gpt-5.6-terra` est réel : prévoir un budget mensuel par
  équipe dès la phase 7.
