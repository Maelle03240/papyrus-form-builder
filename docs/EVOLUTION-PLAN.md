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
| TypeScript | 5.6 | 6.0 (voir ci-dessous) |
| Tailwind | 3.4 | 4.3 (config CSS-first) |
| ESLint | 8.57 | 9.39 (flat config, voir ci-dessous) |
| Zod | 3.23 | 4.5 |
| supabase-js / ssr | 2.45 / 0.5 | 2.115 / 0.12 |
| Recharts | 2.12 | 3.10 |
| Framer Motion | 11.5 | 13.2 |
| — | — | `openai` 7.10 (nouveau) |

Les trois montées cassantes : **Tailwind 4** (les tokens passent en `@theme`),
**Recharts 3**, **Framer Motion 13**.

Deux versions sont volontairement en retrait d'une majeure, parce que l'outillage
de lint ne suit pas encore :

- **TypeScript 6.0 et non 7.0.** `typescript-eslint` refuse explicitement de se
  charger contre TS 7 — il lève au chargement de la config. Repasser en 7 dès que
  le plugin suit (typescript-eslint#10940).
- **ESLint 9.39 et non 10.** La 10 a retiré `context.getFilename()`, que
  `eslint-plugin-react` 7.37 — embarqué par `eslint-config-next` — appelle encore.

`next lint` a disparu de la CLI Next 16 : le script `lint` appelle `eslint .`.

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

**0 — Stack et fondations.** ✅ **Fait le 07/09/2026.** Montée de version
complète, Tailwind 4, flat config ESLint. Ajout de vitest + Playwright et d'un
script `verify` (typecheck + lint + tests + build), vert de bout en bout.

Ce qui a réellement bougé : `cookies()` attendu dans les accesseurs de
`@supabase/ssr` plutôt qu'en rendant `createClient` asynchrone (zéro retouche sur
ses soixante-dix appels) ; `params` promis sur neuf gestionnaires de route et
trois pages dynamiques ; les refs React 19 élargies en `RefObject<T | null>` ;
les étiquettes de camembert Recharts 3 normalisées ; `rounded` nu réécrit en
`rounded-sm`, `outline-none` en `outline-hidden`, l'échelle d'ombres décalée.
`react-hook-form` et `@hookform/resolvers` ont été retirés : plus aucun import.

**1 — Projets, sections, navigation.** Scindée en deux, parce que les deux
moitiés n'ont ni la même surface ni le même risque.

**1a — Couche projet.** ✅ **Fait le 07/09/2026.** Table `projects`,
`forms.project_id` avec reprise des données, `form_versions`, les trois routes et
toute l'arborescence d'onglets, « Nouveau projet » aux points d'entrée. Additif :
rien de l'existant ne change de forme. Le builder, l'onglet Réponses et l'onglet
Analyse sont sortis de `/forms/[id]` en composants pour être montés par les deux
arborescences.

**1b — Sections réelles.** ✅ **Fait le 07/09/2026.** Table `sections`,
`fields.section_id`, `logic_rules.target_section_id`, suppression du type
`section_break`. Migration 004 appliquée : 15 ruptures converties en 25 sections,
70 champs rattachés, aucun orphelin.

Trois pièges rencontrés, tous silencieux :

- PostgreSQL **fige la liste des colonnes d'un `select *` à la création d'une
  vue**. `public_fields` et `public_logic_rules` devaient être recréées, sans
  quoi le rendu public aurait reçu des champs sans section — c'est-à-dire un
  formulaire vide, sans la moindre erreur.
- `field_order` est devenu **relatif à sa section**. Trier les champs sur ce seul
  critère entrelace les sections : les questions s'affichent dans le désordre et
  rien ne le signale. Le tri à deux niveaux est couvert par des tests.
- `updateForm` ne synchronise pas les sections par différence, contrairement aux
  champs : un enregistrement automatique parti avec une liste incomplète
  supprimerait une section, et la cascade emporterait ses questions.

Une décision réduit beaucoup le risque : **le catalogue de modèles garde
`section_break` comme convention d'écriture**, et `lib/templates/to-form.ts` le
convertit en sections réelles à l'import. `lib/templates/types.ts` décrit un
format de fichier de contenu, pas le modèle de données — les 51 fichiers JSON
n'ont donc pas à être réécrits.

**2 — Parité des champs et visibilité.** ✅ **Fait le 07/09/2026.** Les dix
types sont livrés — `currency`, `address`, `country`, `yesno`, `signature`,
`repeater`, `calculated`, `link`, `hidden`, `divider` —, ainsi que le verrou de
visibilité porté par le champ et par la section, l'éditeur de conditions, et le
panneau de réglages d'une section. Migration 005 appliquée. Rien n'est perdu de
Papyrus : matrice, NPS, notation, vidéo, sous-questions et score sont intacts.

**La décision de conception qui structure toute la phase** : deux mécanismes
d'affichage cohabitent, et leur arbitrage est un ET.

- `logic_rules` s'écrit depuis la question **source** — « quand on répond oui
  ici, montrer là-bas ». C'est le point de vue du parcours, et le seul qui sache
  faire un saut de page.
- `Field.visibility` / `Section.visibility` s'écrit depuis l'élément **cible** —
  « ne m'affiche que si… ». C'est le seul point de vue praticable quand une même
  question dépend de trois autres, et c'est celui de mooove-invoice.

Un élément est visible si la logique le dit visible **et** que son verrou
s'ouvre. Un verrou ne peut donc jamais forcer l'apparition de ce qu'une règle
masque : sans cette règle, deux auteurs travaillant chacun dans son panneau
écriraient l'inverse l'un de l'autre sans jamais voir le conflit.
`lib/visibility.ts` est le point d'entrée unique — navigateur et serveur
appellent la même fonction, sur les mêmes réponses.

Quatre pièges rencontrés, tous silencieux :

- **Le `select *` d'une vue est figé à sa création** — le même piège qu'en
  migration 004, et il vaudra pour toute colonne ajoutée ensuite. Sans recréer
  `public_fields` et `public_sections`, le répondant aurait vu toutes les
  questions conditionnelles à la fois et les répéteurs sans leurs sous-questions.
- **Une chaîne de conditions ne se referme pas d'elle-même.** « Q1 ouvre Q2, la
  réponse à Q2 ouvre Q3 » : un retour en arrière sur Q1 fait disparaître Q2, mais
  sa réponse reste en mémoire et continuerait d'afficher Q3.
  `evaluateFormVisibility` itère donc jusqu'au point fixe, borné à vingt passes —
  deux verrous peuvent s'exclure mutuellement et osciller indéfiniment.
- **Un verrou copié reste branché sur le formulaire d'origine.** Ses conditions
  désignent des champs par identifiant, et ceux-là existent toujours. Duplication
  et import attribuent maintenant les identifiants de champ **avant** toute
  insertion, parce que trois choses y font référence et que deux d'entre elles
  partent en base avant les champs : le verrou d'une section, celui d'un champ —
  qui peut citer une question placée plus bas — et les sources d'un champ calculé.
- **Un bloc répétable garde toujours une ligne à l'écran.** Compter ses lignes
  telles quelles ferait annoncer un participant à un formulaire auquel personne
  ne s'est inscrit, et un bloc obligatoire passerait la validation sur sa seule
  ligne d'accueil. `isAnswerEmpty` traite désormais une structure dont toutes les
  valeurs sont vides comme vide, et le comptage ne retient que les lignes
  remplies. C'est un test de navigateur qui a levé l'incohérence.

Trois écarts assumés par rapport à mooove-invoice :

- **La signature est tracée à la main**, déposée sur R2, et c'est son adresse qui
  est enregistrée. mooove-invoice se contentait d'une case « je certifie » — une
  case cochée n'est pas une signature, et personne ne la reconnaîtrait comme
  telle sur un bon de commande.
- **`calculated` fait aussi la somme**, pas seulement le décompte des lignes d'un
  bloc. Un champ calculé qui ne sait que compter des répéteurs n'est pas un champ
  calculé.
- **`address` reste une saisie libre sur plusieurs lignes**, comme dans
  mooove-invoice. Une adresse structurée changerait la forme de la réponse, donc
  l'export, la feuille Google, le PDF et les colonnes — la phase 5 reprend tout
  cela de toute façon.

Le total d'un champ calculé est **recalculé côté serveur**, deux fois : avant
l'évaluation des conditions, pour qu'un affichage qui dépend d'un total soit
tranché par le vrai chiffre, et après le masquage, parce qu'une branche
abandonnée a pu emporter le bloc qu'il comptait. Sa valeur arrive bien dans la
requête — le répondant la voit à l'écran — mais rien n'empêche de la remplacer
avant l'envoi.

**3 — Tarification.** ✅ **Fait le 07/09/2026.** Prix par option, compteurs de
quantité, `count_in_total`, TVA, codes de réduction, tarifs dégressifs. Totaux en
direct sur le formulaire public et instantané figé à l'envoi. Onglet Tarification
sur le formulaire, devise et TVA sur le projet. Migration 006 appliquée.

**Trois principes tiennent tout le moteur** (`lib/pricing.ts`) :

1. **On ne facture que ce qui est à l'écran.** Le calcul part de
   `evaluateFormVisibility`, la même fonction que le rendu et que l'envoi. Une
   option cochée puis masquée par un changement de branche ne peut pas rester
   dans le total — c'est le genre d'écart qu'un répondant ne découvre qu'en
   recevant sa facture.
2. **Tout est compté en centimes entiers.** Additionner des flottants dérive dès
   la troisième ligne, et la dérive s'imprime. La conversion en unités n'a lieu
   qu'à la fin.
3. **L'instantané se suffit à lui-même.** Il porte le détail ligne à ligne, pas
   seulement le total. mooove-invoice ne gardait que sous-total, TVA et total :
   six mois plus tard, avec des prix modifiés entre-temps, plus rien ne
   permettait d'expliquer une facture.

**Le piège de la phase, rencontré deux fois.** Le code de réduction n'est pas une
question, donc pas un champ : sa clé réservée `__discount_code` a une racine
vide. Or `/api/submit/[slug]` filtre les réponses sur « la racine correspond à un
champ connu », **et** écarte ensuite celles des champs devenus invisibles. Les
deux passes supprimaient le code. La remise s'affichait à l'écran et disparaissait
de la facture, sans une erreur. La même faille existait dans la route des
réponses partielles : un répondant qui revenait sur son formulaire retrouvait
tout sauf sa remise. Les deux routes l'autorisent maintenant explicitement.

**Où vit quoi.** Devise, position du symbole, TVA et son taux sont portés par le
**projet** — un même événement facture dans une seule monnaie. Prix, remises,
paliers et libellés sont portés par le **formulaire**, parce qu'ils désignent ses
options. La résolution a lieu **à la lecture** (`resolvePricing`), jamais à
l'écriture : changer la devise d'un projet se répercute sur ses formulaires au
lieu de les laisser figés sur l'ancienne. Une seule règle, appliquée par le
navigateur comme par le serveur, plutôt qu'une fusion dupliquée en SQL.

**Les prix des options ne prennent pas de colonne** : ils vivent sur l'option
elle-même, dans `fields.options`. C'est l'option qui est vendue — la renommer, la
déplacer ou la dupliquer emporte son prix.

**Le compte des inscriptions n'est exposé que s'il sert.** `public_forms` ne
publie `registered_count` que lorsqu'un tarif dégressif est actif : un tarif early
bird annonce de lui-même « il reste N places », alors que le nombre de réponses
d'un sondage ne regarde personne.

**4 — E-mails et facturation.** ✅ **Fait le 07/09/2026.** Règles d'e-mail
conditionnelles, bilingues, `{{jetons}}`, éditeur riche, pièce jointe PDF.
Numérotation par projet, sans course critique. Génération du bon de commande.
Écran de remerciement configurable. Migration 007 appliquée.

**La règle d'arbitrage de la phase** : quand `email_config.enabled` est vrai, il
**remplace** l'accusé de réception hérité de `notification_settings.respondent`.
La notification interne, elle, continue de partir — elle ne s'adresse pas à la
même personne. Sans cet arbitrage, un auteur qui règle le nouvel onglet sans
penser à l'ancien enverrait deux e-mails à chaque inscrit, et ne le découvrirait
que par une plainte.

**La numérotation tient trois propriétés, et chacune répond à une manière précise
de se tromper** (`assign_invoice_number`, migration 007) :

1. **Atomique.** L'incrément et sa lecture sont un seul `update … returning`,
   donc sous verrou de ligne.
2. **Après l'insertion, jamais avant.** mooove-invoice tire le numéro d'abord :
   un enregistrement qui échoue ensuite laisse un trou définitif dans une
   séquence censée être continue. Ici la réponse existe déjà, donc un échec ne
   consomme rien.
3. **Rejouable, et verrouillée pour l'être vraiment.** Le premier jet lisait le
   numéro existant sans `for update` : huit sessions concurrentes sur la même
   réponse ont brûlé **six numéros sur seize**. Chacune lisait « pas de numéro »,
   en tirait un, et une seule s'écrivait. Avec le verrou, les mêmes quarante
   appels attribuent dix numéros à dix réponses, sans un trou.

**Quatre défauts silencieux rencontrés, tous trouvés en regardant le résultat
plutôt que le code :**

- **Les jetons de champ ne se résolvaient pas.** Le motif `\{\{([\w.]+)\}\}`
  vient de mooove-invoice, dont les identifiants de champ sont des slugs. Ceux de
  Papyrus sont des **UUID**, donc ils contiennent des tirets — que `\w` exclut.
  Chaque réponse insérée partait telle quelle : « Bonjour
  {{ea92b44b-d0e7-…}}, ». Rien ne le signalait ; il a fallu lire un message rendu.
- **Les montants à quatre chiffres s'imprimaient « 3?000,00 ».** `formatMoney`
  produit du fr-FR, où l'espace des milliers est une ESPACE FINE INSÉCABLE
  (U+202F) : hors de Latin-1, donc remplacée par `?` avant d'atteindre le PDF.
- **Les valeurs de jeton n'étaient pas échappées.** Elles viennent du répondant :
  un nom contenant `<b>` déformait le message, et une balise mieux choisie aurait
  fait pire. Le gabarit, lui, reste du HTML voulu — c'est l'auteur qui l'écrit.
- **Une règle sans condition captait tout.** Elle correspond à n'importe quelle
  réponse, donc elle masque en silence toutes celles qui la suivent. Elle est
  maintenant ignorée à l'envoi *et* retirée à l'enregistrement, pour que
  l'auteur voie disparaître ce qui ne servait à rien.

**Deux choix d'interface qui ne sont pas cosmétiques.** Un jeton s'affiche dans
l'éditeur sous le **libellé** de sa question, mais s'enregistre par son
**identifiant** : renommer une question ne doit pas casser en silence les e-mails
qui la citent, et un auteur ne doit pas relire un paragraphe rempli d'UUID. Et
l'aperçu passe par la **même** fonction de rendu que l'envoi — un aperçu
approximatif est pire que pas d'aperçu, parce qu'on cesse de vérifier le vrai
message.

**Le document PDF est le même dans les deux cas**, récapitulatif ou bon de
commande : ce qui les distingue est la présence d'un numéro et de totaux, pas la
mise en page. Deux gabarits divergeraient au premier changement.

**Ce qui manque pour que la phase serve en production** : `RESEND_API_KEY`
n'est configurée nulle part — ni en local, ni dans le service Easypanel. Le
chemin complet est vérifié jusqu'à l'appel réseau (Resend répond « API key is
invalid » avec une clé factice, et l'échec est écrit sur la réponse), mais aucun
e-mail ne peut partir tant que la clé n'est pas posée. L'accusé de réception
hérité avait déjà ce défaut, ce qui explique que personne ne l'ait vu.

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
  après les phases 1 et 2. Fait : 51 modèles reconstruits et validés à l'issue de
  la phase 2. Ils continuent d'écrire `section_break` — c'est un format de
  fichier de contenu, converti à l'import, et aucun n'utilise encore les dix
  nouveaux types.
- Le rendu public est touché en phases 1, 2 et 3 : ces phases se font en série,
  jamais en parallèle.
- TypeScript 7 et Tailwind 4 peuvent remonter beaucoup d'erreurs d'un coup en
  phase 0 — c'est le but de la faire en premier, à vide.
- Le coût des appels `gpt-5.6-terra` est réel : prévoir un budget mensuel par
  équipe dès la phase 7.
- **La tarification s'appuie entièrement sur la visibilité.** Un défaut de
  `lib/visibility.ts` devient désormais un défaut de facturation. Les deux
  modules sont couverts par des tests, mais toute évolution de l'un doit relire
  les tests de l'autre.
- **Deux systèmes d'affichage cohabitent désormais** (`logic_rules` et les
  verrous de visibilité). Leur arbitrage est fixé par des tests, mais rien dans
  l'interface ne montre encore à l'auteur qu'une question est masquée à la fois
  par une règle et par un verrou. À surveiller quand la phase 7 laissera l'IA
  écrire les deux.
- **Aucun libellé de la vue publique n'est associé à son contrôle.** Le `<label>`
  d'une question n'a ni `for` ni imbrication, pour tous les types de champ : un
  lecteur d'écran annonce une zone de saisie sans nom, et un test de navigateur
  ne peut viser un champ que par son invite. Défaut antérieur à la phase 4,
  découvert en écrivant ses tests, et qui vit dans `FieldRenderer` — partagé avec
  le constructeur. À reprendre en phase 8, avec le reste du durcissement du rendu
  public.
- **59 violations des règles du React Compiler** (`eslint-plugin-react-hooks` v6),
  révélées par la phase 0 : 31 `set-state-in-effect`, 13 `refs`, 6
  `static-components`, 5 `immutability`, 2 `preserve-manual-memoization`, 2
  `purity`. Elles sont en avertissement, pas en erreur — les corriger est une
  refactorisation à part entière, et le React Compiler restera hors d'atteinte
  tant qu'elles sont là. À faire décroître phase après phase.
- **`xlsx` porte une faille haute sans correctif** sur npm (pollution de
  prototype, ReDoS) : SheetJS ne publie plus sur le registre public. Papyrus ne
  fait qu'écrire des exports, l'exposition est faible — à remplacer en phase 5,
  quand les exports seront repris de toute façon.
