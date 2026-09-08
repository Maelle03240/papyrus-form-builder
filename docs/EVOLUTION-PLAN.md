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

**5 — Records, Insights, Share, Integrations.** ✅ **Fait le 08/09/2026.**
Workflow de statut, filtres, PDF par réponse, export XLSX en masse. Vue Records
agrégée au niveau projet. Répartition Sheets par valeur de champ vers plusieurs
onglets. Insights enrichis des indicateurs de tarification. Migration 008
appliquée. La resynchronisation existait déjà depuis la phase 0 ; elle sait
désormais réécrire plusieurs onglets.

**`xlsx` est retiré des dépendances.** Sa dernière version publiée sur npm porte
deux failles **sans correctif** — pollution de prototype et expression régulière
exponentielle —, et l'auteur ne publie plus que sur son propre serveur : une
dépendance qu'on ne peut plus mettre à jour n'est pas une dépendance, c'est une
dette. Remplacée par `write-excel-file`. `npm audit` rend **zéro vulnérabilité**,
pour la première fois du projet.

**La décision qui structure la phase : une réponse annulée cesse de compter, sans
disparaître.** `void` la retire du chiffre d'affaires, du quota `max_submissions`
et du palier d'un tarif dégressif — annuler une inscription doit libérer la place
qu'elle occupait, sinon l'annulation ne veut rien dire. Elle reste dans le
décompte des réponses et à l'écran, en retrait : la faire disparaître laisserait
« où est passée l'inscription de Bruno ? » sans réponse. Trois comptes appliquent
la règle et doivent rester alignés — la vue `public_forms` (ce que le répondant
voit), `checkSubmissionLimit` et le compte des tarifs dégressifs (ce que le
serveur accepte).

**Un seul module filtre et met en colonnes** (`lib/records.ts`), pour le tableau
comme pour l'export. Le bandeau de chiffres, le tableau et le fichier portent
donc tous les trois sur les mêmes lignes. Et l'export part du **serveur** avec le
filtre en paramètre d'URL, plutôt que de sérialiser ce que la page a chargé : les
deux divergent dès qu'un tableau pagine, et on ne s'en aperçoit qu'après avoir
envoyé le fichier à quelqu'un.

**Trois pièges rencontrés :**

- **Le même filtre de dates retenait deux ensembles de lignes différents.**
  « Du 1er au 8 septembre » ne désigne pas le même intervalle d'instants selon
  l'endroit d'où on le lit : le tableau bornait la journée dans le fuseau du
  navigateur, l'export dans celui du serveur. Le filtre transporte désormais le
  décalage horaire (`tz_offset`), et l'absence de valeur vaut UTC — jamais le
  fuseau de la machine, qui dépend de l'hébergement.
- **Un classeur à plusieurs formulaires ne peut pas tenir sur une feuille.** Deux
  formulaires n'ont pas les mêmes questions : les empiler sous un seul en-tête
  ferait glisser les réponses du second sous les intitulés du premier — un
  fichier qui s'ouvre sans erreur, se lit sans soupçon, et dit n'importe quoi.
  L'export projet écrit un onglet par formulaire.
- **Excel ne refuse pas un onglet mal nommé : il refuse le fichier.** Un onglet
  tiré d'une réponse libre — « Formule : Table de 6 » — produirait un classeur
  illisible. Les noms sont donc nettoyés, tronqués à 31 caractères et
  dédoublonnés après troncature.

**Les montants partent en nombres, pas en texte.** Dans un tableur, une somme est
ce qu'on fait d'une colonne de prix, et « MUR 3 450,00 » ne s'additionne pas. La
devise a sa propre colonne ; le numéro de commande, lui, reste du texte, sans
quoi « SONDE-0007 » s'afficherait « 7 ».

**Le classement de ce qui se vend** sort du détail figé à l'envoi — la décision
de la phase 3 de conserver l'instantané ligne à ligne plutôt que le seul total.
C'est ce qui permet de répondre à « qu'est-ce qui se vend », six mois plus tard,
avec des prix modifiés entre-temps.

**6 — Partenaires et contacts.** ✅ **Fait le 08/09/2026.** Annuaire au niveau
équipe, participation par projet, code de partage, page d'accueil publique
`/a/[code]`, portail `/p/[token]`, lien d'auto-inscription `/a/join/[token]`,
registre de commission des deux côtés, carnet de contacts et export XLSX.
Migration 009. Authentification partenaire sur Supabase Auth, comme décidé.

**L'identité partenaire est un compte Supabase Auth**, marqué
`app_metadata.papyrus_role = 'partner'` — dans `app_metadata` et non
`user_metadata`, que son propre titulaire peut modifier. Trois pièges de
l'existant ont dû être levés pour que ce choix tienne :

- **`/auth/callback` SUPPRIME le compte qu'il refuse.** Un partenaire est par
  définition extérieur à l'équipe : sur une instance qui restreint les domaines
  autorisés, chaque partenaire aurait vu son compte détruit à sa première
  connexion. `evaluateAccess` reconnaît désormais une fiche partenaire, au même
  titre qu'une invitation nominative.
- **Le callback créait un espace de travail personnel à tout arrivant.** Un
  partenaire y aurait reçu son propre Papyrus, vide.
- **Rien n'empêchait un partenaire d'ouvrir `/dashboard`.** Il a une session
  valide ; la RLS lui aurait donné des écrans vides plutôt qu'une porte fermée,
  et un écran vide se lit comme une panne. Le middleware le renvoie à son
  portail.

**Un partenaire n'a aucune policy sur les tables.** Il lit quatre vues qui se
filtrent elles-mêmes sur `current_partner_ids()`, et il écrit uniquement par des
routes en `service_role` qui vérifient ses droits. La surface à relire est donc
de quatre vues, pas de six tables.

**Trois écarts assumés par rapport à mooove-invoice :**

- **Le partenaire ne voit pas les réponses au formulaire.** mooove-invoice lui
  ouvre le détail complet de chaque inscription ; ici la vue
  `partner_registrations` n'expose que la ligne — date, adresse, référence,
  montant, statut, commission. Un bulletin d'inscription peut contenir un numéro
  de passeport ou une restriction alimentaire : ce n'est pas l'affaire de
  l'apporteur d'affaires, et personne n'aurait choisi cette exposition en la
  voyant écrite.
- **L'auto-inscription n'ouvre aucun accès.** mooove-invoice connecte le nouveau
  partenaire sur-le-champ. Intransposable ici : le portail s'ouvre avec un vrai
  compte d'authentification, et délivrer un lien de connexion à un visiteur
  anonyme qui a simplement TAPÉ une adresse donnerait le compte de n'importe qui
  à n'importe qui. La page enregistre une demande ; l'équipe ouvre l'accès.
- **Les contacts se rassemblent quand on veut**, pas seulement à l'archivage du
  projet. On écrit aux inscrits pendant l'événement, pas après. Le geste est
  rejouable et dédoublonné par (projet, adresse).

**L'adresse IP n'est pas conservée** pour compter les visites. mooove-invoice la
stocke en clair ; Papyrus avait déjà tranché l'inverse pour les réponses (« sans
sel configuré, on préfère ne rien stocker qu'un hachage faible »), et une IP
hachée avec un sel connu se retrouve de toute façon par force brute. Le visiteur
est identifié par un cookie tiré au sort, posé par le middleware, valable trente
minutes — ce qui compte mieux : derrière un partage de connexion, une IP confond
dix visiteurs en un seul.

**Deux pièges rencontrés :**

- **La toute première visite d'un nouveau venu n'était pas comptée.** Le cookie
  n'était écrit que sur la réponse ; la page rendue au même instant ne le voyait
  donc pas. Un partenaire dont le lien amène une inscription aurait lu
  « 0 visite, 1 inscription » — et conclu, à raison, que le compteur est faux.
  Le middleware l'écrit désormais aussi sur la requête. Vérifié en production :
  une visite fraîche compte 1, cinq visites du même visiteur comptent 1.
- **Les quatre nouvelles tables étaient invisibles de l'application entière.**
  Les `alter default privileges` de la migration 001 ne valent que pour les
  objets créés par le rôle qui les a posés ; ces tables-ci sont créées par
  `supabase_admin`. Sans droits, la RLS n'est même pas consultée — il n'y a rien
  à filtrer. Les `grant` sont désormais explicites, comme en migration 003.

**Ce que l'attribution garantit**, vérifié sur la base de production : un code
valide du projet attribue la réponse ; un code valide d'un AUTRE projet
n'attribue rien (sans quoi coller le code d'un confrère lui vaudrait des
commissions qu'il n'a pas apportées) ; un code inconnu n'attribue rien et
n'empêche pas l'inscription. Le code voyage dans l'URL et jamais dans un cookie :
un cookie survivrait à la visite d'un autre lien.

**7 — Couche IA.** ✅ **Fait le 08/09/2026.** Réglages par espace (clé chiffrée,
modèle, budget), 34 outils typés, orchestrateur en flux sur l'API Responses,
assistant de création, panneau de conversation ancré dans le constructeur.
`/api/generate-form` et OpenRouter supprimés, ainsi que le second chemin où l'on
collait à la main le JSON produit par son propre ChatGPT. Migration 010.

**Aucun JSON brut, et c'est toute l'architecture.** L'ancienne route demandait un
objet complet à un modèle et l'importait tel quel : un type de champ inventé, un
identifiant qui ne désigne rien, une règle logique qui pointe dans le vide
passaient sans que rien ne les arrête. L'IA appelle désormais des outils nommés,
validés par Zod, refusés s'ils ne tiennent pas — et **exécutés sous la session de
l'utilisateur, donc sous RLS**. Elle ne peut toucher aucune donnée que la
personne devant l'écran ne pourrait toucher elle-même ; un `service_role` ici,
plus simple à écrire, aurait signifié qu'une phrase mal tournée peut atteindre le
formulaire d'une autre équipe.

**Les outils de lecture comptent autant que ceux d'écriture.** `describe_form` et
`describe_project` ne figuraient pas au tableau du plan ; sans eux, le modèle ne
connaît aucun identifiant de question et doit en inventer pour écrire une règle,
un prix ou une condition — exactement ce qu'on supprime.

**La clé vit par espace de travail, jamais dans l'environnement.** Une clé
d'instance ferait payer une équipe pour les appels d'une autre, sans qu'aucune
des deux puisse le voir. Elle est chiffrée par `lib/crypto.ts` dans une table
sans AUCUNE policy — comme `tally_credentials` : rien de ce qu'elle contient n'a
de raison d'atteindre un navigateur, fût-ce chiffré. L'écran n'affiche que son
empreinte, « sk-…a3f9 ».

**Les tarifs ne sont pas codés en dur.** Une table de prix figée dans le dépôt
afficherait des montants faux avec l'aplomb d'un chiffre exact le jour où le
fournisseur change sa grille. Les jetons, eux, sont un fait rendu par l'API :
l'équipe saisit ses tarifs, le coût est figé à l'écriture avec ceux en vigueur —
même raison que l'instantané de prix d'une réponse — et le plafond est vérifié
AVANT chaque tour. À tarifs nuls, le coût vaut zéro et l'écran le dit en toutes
lettres plutôt que de laisser croire à une surveillance qui n'existe pas.

**Deux pièges rencontrés :**

- **Une règle de logique citant une question inexistante était acceptée.**
  Trouvé en éprouvant les outils contre la vraie base, pas en test unitaire : la
  clé étrangère ne protège que la CIBLE d'une règle ; les conditions vivent dans
  une colonne `jsonb`, où PostgreSQL n'a rien à contrôler. La règle ne se
  déclenchait jamais, ne journalisait rien, et ne se serait découverte que le
  jour où un répondant dit n'avoir pas vu la question promise. Les identifiants
  cités sont désormais vérifiés par `add_logic_rule`, `set_visibility` et
  `add_email_rule`.
- **Les écritures sur un champ ne portaient que sur son identifiant.** La RLS
  s'arrête à l'espace de travail : rien n'empêchait de modifier au passage la
  question d'un formulaire voisin. Toutes sont bornées au formulaire ouvert.

**Ce qui a été éprouvé en production** : les réglages aller-retour avec la clé
chiffrée en base et jamais relue, le refus au-delà du plafond (409, avant tout
appel au fournisseur), le refus d'accès à une autre équipe (404 sur les trois
routes), un tour complet de bout en bout dont l'erreur du fournisseur est
traduite en phrase actionnable, et surtout **un formulaire entier construit par
la couche d'outils contre la vraie base** — six questions, une condition
d'affichage, une règle de logique, trois prix, TVA, publication — puis ouvert et
rendu correctement à son adresse publique.

**8 — Voix et durcissement.** ✅ **Fait le 08/09/2026.** La voix dans les deux
sens, la revue des droits table par table, et le rendu public rendu lisible aux
lecteurs d'écran.

**La voix, deux chemins et non un.** La conversation en temps réel
(`gpt-realtime-2.1`, WebRTC) ouvre un flux audio du navigateur au fournisseur :
on parle, ça répond en parlant, et les outils s'appellent pendant la
conversation. La dictée (`gpt-transcribe`) enregistre, transcrit côté serveur et
dépose le texte dans la zone de saisie. Le second n'est pas un repli de
confort : c'est celui qui marche derrière un pare-feu qui filtre UDP, et celui
dont la consommation est mesurable.

**La clé ne quitte jamais le serveur.** En temps réel, le serveur l'échange
contre un jeton éphémère qui ne vaut que pour une session. Une clé d'API livrée
au navigateur serait lisible dans l'onglet réseau par quiconque ouvre les outils
de développement, et facturée à l'équipe jusqu'à ce que quelqu'un s'en aperçoive.

**Les outils ne s'exécutent jamais dans le navigateur.** Le modèle parle
directement au navigateur : ses demandes d'outils arrivent donc là-bas. Elles
repartent aussitôt vers `/api/ai/tool`, qui les exécute sous la session de la
personne, donc sous RLS — et qui prend l'instantané avant la première écriture,
sans quoi une construction dictée ne serait pas annulable alors que la même
construction écrite l'est.

**La consommation vocale est déclarée par le navigateur, et c'est écrit à
l'écran.** Le son ne passe pas par nos serveurs : le seul endroit où le décompte
existe est la fin de session, côté client. Refuser de l'enregistrer laisserait
la voix invisible dans le budget — une dépense réelle absente du compteur, ce
qui est pire qu'un compteur perfectible. Le plafond, lui, reste vérifié côté
serveur avant chaque ouverture.

Trois défauts trouvés en éprouvant les droits contre la base de production :

- **Inviter un collègue échouait, et échouait déjà avant cette phase.**
  `team_invitations` n'avait que des policies de LECTURE, alors que l'écran
  Paramètres → Équipe y insère, y modifie et y supprime depuis le navigateur.
  Trois policies ajoutées, une par commande.
- **`anon` gardait DELETE, INSERT, UPDATE et TRUNCATE sur tout le socle** —
  `forms`, `fields`, `submissions`, `teams`, `profiles`. Rien ne passait : les
  policies exigent toutes `is_team_member()`, faux sans session. Mais la seule
  chose qui séparait un visiteur anonyme de la suppression de tous les
  formulaires était la clause d'une policy. Le visiteur n'a besoin de RIEN sur
  les tables : il lit les vues `public_*`.
- **Les droits de `authenticated` dépassaient partout ses policies** : INSERT
  sur `submissions`, qui n'a aucune policy d'insertion — une réponse n'entre que
  par `/api/submit`, qui la valide, la tarife et la gèle. Ils sont ramenés à ce
  que les policies autorisent, pour que lire les droits d'une table dise la
  vérité sur ce qu'on peut y faire.

**Le libellé d'une question nomme enfin son champ.** Défaut relevé en phase 4,
présent pour tous les types à la fois : le `<label>` n'avait ni `for` ni
imbrication. Deux formes de rattachement, parce que deux formes de question — un
`<label for>` quand il y a un contrôle à désigner, un groupe nommé
(`role="group"` + `aria-labelledby`) quand la réponse se donne sur plusieurs
contrôles. Désigner le premier bouton d'une question à choix dirait à un lecteur
d'écran que l'intitulé appartient à cette option-là. La mention « obligatoire »
est dite ; l'astérisque, lui, est masqué — à l'oreille il ne produit rien, ou
« étoile ».

L'audit des routes `service_role` n'a rien trouvé : les vingt-cinq qui
l'emploient vérifient toutes les droits de l'appelant, ou sont publiques par
construction et bornées en cadence (`/api/submit`, `/api/forms/access`,
`/api/check-duplicate`, `/api/a/join`, `/api/health`).

Vérifié contre la base de production : `scripts/rls-session-test.mjs` (15
contrôles, avec une vraie session `authenticated`), les quatre nouvelles routes
vocales (401 sans session, 404 sur une équipe étrangère, 409 avant tout appel au
fournisseur), et quatorze parcours Playwright — dont l'attribution partenaire
menée de bout en bout dans un navigateur : le code du bon projet attribue, celui
d'un projet voisin ne bloque pas l'envoi, et trois visites de trois visiteurs
comptent trois clics.

**9 — Revue complète.** ✅ **Faite le 08/09/2026.** Les huit phases finies, on a
traversé l'application écran par écran, connecté, avec un formulaire portant les
vingt-sept types de champ, deux sections, une règle de logique et de la
tarification. Neuf défauts, dont aucun ne se voyait au typage ni dans les tests
unitaires — et dont plusieurs étaient là depuis le début.

**Le plus grave : l'aperçu montait ses propres vues.** Huit cents lignes qui
recopiaient `components/public/` et devaient rester identiques. Elles ne
l'étaient plus : l'aperçu évaluait la visibilité avec les seules règles de
logique, quand la vraie page y ajoutait les verrous portés par les champs et les
sections. Un formulaire pouvait s'afficher entier à l'auteur et masquer une
question au répondant, sans que rien ne le signale. L'aperçu monte désormais **la
vraie vue publique**, avec un drapeau `preview` qui n'empêche que l'envoi. La
question « est-ce que l'aperçu dit la vérité ? » ne se pose plus.

**Un formulaire clos répondait 500.** `ClosedFormPage` est un composant serveur ;
il passait deux rappels vides à un composant client, ce que Next refuse de
sérialiser. Le jour où un formulaire atteignait sa date de clôture, ses
visiteurs recevaient une erreur serveur au lieu du message rédigé par l'auteur.

**Le mode « une question à la fois » promouvait n'importe quoi en écran.** Un
séparateur devenait un écran vide et numéroté ; un champ caché, un écran sans
rien dedans ; et le compteur d'accueil annonçait vingt-sept questions pour
vingt-trois. Les quatre types qui affichent déjà leur intitulé — texte libre,
image, vidéo, lien — le voyaient répété deux fois de suite. Les deux autres
modes ne montraient rien de tout cela : c'est ce mode-là qui divergeait.

**Le texte destiné à l'auteur s'affichait au répondant.** « Aucune source —
choisissez ce qui doit être compté dans le panneau de droite », sur un
formulaire publié, devant quelqu'un qui n'a pas de panneau de droite. Même
chose pour un bloc répétable sans sous-question. Le constructeur et la vue
publique partagent leurs composants de champ — c'est voulu, l'auteur voit ce que
le répondant verra — mais rien ne séparait les états d'auteur des états de
répondant. `lib/public-fields.ts` le fait maintenant.

**« Calculer sans montrer » ne cachait rien.** La case existait dans le
constructeur, elle n'était honorée nulle part : le total s'affichait quand même.
La valeur continue d'être calculée et enregistrée ; c'est l'affichage qui est
retiré.

**Les invitations d'équipe cassaient à quatre endroits**, chacun invisible
depuis les autres : créer une invitation était refusé par la RLS (corrigé en
phase 8) ; lister les membres échouait sur `PGRST200`, parce que le code
demandait à PostgREST de suivre un lien entre `team_members` et `profiles` qui
n'existe pas — les deux pointent vers `auth.users`, jamais l'un vers l'autre ;
ouvrir un lien d'invitation ne montrait rien, l'invité n'ayant aucun droit sur
l'équipe qu'on lui proposait de rejoindre ; et accepter appelait
`accept_team_invitation`, une fonction que **le code appelle depuis toujours et
qu'aucune migration n'a jamais créée**. La migration 012 apporte les deux
fonctions manquantes, en `security definer` et par jeton exact — ouvrir la table
en lecture aurait laissé n'importe qui énumérer tous les jetons en attente.

**Le QR code de l'onglet Partage ne s'est jamais affiché.** Il venait
d'`api.qrserver.com`, que la politique de sécurité de contenu n'autorise pas :
le navigateur bloquait l'image sans un mot à l'écran. Il est désormais calculé
dans le navigateur, en `data:` — ce qui règle aussi le fait qu'on envoyait
l'adresse de chaque formulaire à un service tiers à chaque ouverture de l'onglet.

**Les grilles d'options n'étaient pas responsives.** `grid-cols-2` et
`grid-cols-3` sans point de rupture : le drapeau `mobile` n'est passé que par le
cadre téléphone de l'aperçu, jamais par la vraie page. Trois options se
chevauchaient donc sur un vrai téléphone.

Ce qui reste vérifié à la main et ne peut pas l'être autrement : `tests/e2e/audit.spec.ts`,
vingt-deux parcours, avec `scripts/audit-setup.mjs` pour l'espace d'essai et
`scripts/audit-teardown.mjs` pour l'effacer. La console est écoutée sur chaque
page — une erreur non rattrapée fait échouer le test qui l'a provoquée.

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

- **Un écran peut exister et n'être relié à rien.** `/projects/nouveau` — les
  trois questions puis l'assistant — était en place depuis la phase 6, et trois
  des quatre boutons « Nouveau projet » ne s'y rendaient pas : le tableau de
  bord et la barre latérale renvoyaient à la liste, et la liste ouvrait sa
  propre fenêtre à un champ. La porte d'entrée du produit donnait donc un
  projet vide, sans formulaire et sans assistant, pendant que la page qui
  faisait le contraire n'était atteignable que depuis `/forms`. Aucun test ne
  pouvait le voir : chaque écran s'ouvrait, chacun répondait 200. Ce qui
  manquait, c'est un test qui parte d'un **bouton** et regarde où il mène ; il
  existe maintenant pour les deux portes principales.

- **Ce qui n'a pas de test de navigateur n'a pas été vu.** Les neuf défauts de la
  revue ont tous la même forme : le typage est satisfait, les tests unitaires
  passent, la page s'affiche — et quelque chose est faux à l'écran. Trois
  d'entre eux dataient de la première phase. La leçon vaut plus que les
  corrections : `tests/e2e/audit.spec.ts` doit être rejoué après chaque phase,
  pas seulement écrit une fois.

- **Aucun appel réel à `gpt-5.6-terra` n'a été passé.** Aucune clé OpenAI n'est
  disponible sur ce poste : la chaîne est vérifiée jusqu'au fournisseur inclus
  (la clé d'essai est refusée, et le refus est traduit correctement), et la
  couche d'outils est éprouvée contre la vraie base — mais le jugement du modèle
  lui-même, lui, ne l'est pas. Ce qui reste à voir au premier vrai message :
  qu'il appelle `describe_form` avant d'agir plutôt que d'inventer, et qu'il
  s'arrête au lieu d'enchaîner sur une suppression.

- **La voix n'a jamais parlé.** Même raison que ci-dessus : sans clé OpenAI sur
  ce poste, aucune session `gpt-realtime-2.1` n'a été ouverte et aucun
  enregistrement n'a été transcrit. Ce qui est vérifié : les quatre routes
  refusent sans session, refusent une équipe étrangère, et refusent faute de clé
  AVANT tout appel au fournisseur ; un outil s'exécute bien sous la session de
  l'appelant. Ce qui ne l'est pas : la forme exacte des échanges avec le
  fournisseur. Deux points fragiles, et ils sont isolés exprès — le point
  d'entrée de la négociation WebRTC est rendu par le serveur (`sdp_url`), donc
  une constante à changer plutôt qu'un déploiement de navigateurs ; et les noms
  d'événements du canal de données sont reconnus par leur suffixe, parce qu'ils
  ont déjà changé une fois.

- **Le parcours partenaire n'a jamais été parcouru de bout en bout par un vrai
  compte.** L'attribution, le registre, les vues, les droits et les quatre routes
  sont vérifiés sur la base de production ; l'invitation elle-même passe par
  l'API d'administration Supabase, qu'aucun test n'a déclenchée faute de pouvoir
  ouvrir une session de navigateur vers `supabase.mooove.group` depuis ce poste.
  À refaire à la main au premier partenaire réel : ouvrir l'accès, suivre le
  lien, choisir un mot de passe, atterrir sur le portail. La phase 8 a couvert
  tout le reste du parcours dans un navigateur — page d'accueil, attribution,
  code étranger, auto-inscription — mais pas l'invitation elle-même.

- **La répartition Google Sheets n'a pas été essayée contre un vrai compte
  Google.** Aucun n'est connecté sur cette instance : le choix de l'onglet et le
  regroupement de la resynchronisation sont couverts par des tests, l'écriture
  elle-même ne l'est pas. À vérifier au premier projet qui l'active.
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
- ~~**Aucun libellé de la vue publique n'est associé à son contrôle.**~~ Corrigé
  en phase 8 : `lib/field-labelling.ts` décide, par type, si la question peut
  être un `<label for>` ou doit devenir un groupe nommé. Huit parcours Playwright
  désignent désormais chaque champ par son libellé et par rien d'autre — si le
  rattachement disparaît, ils ne trouvent plus rien.
- **70 violations des règles du React Compiler** (`eslint-plugin-react-hooks`
  v6), contre 59 à la phase 0 : 40 `set-state-in-effect`, 15 `refs`, 6
  `static-components`, 5 `immutability`, 2 `preserve-manual-memoization`, 2
  `purity`. Elles sont en avertissement, pas en erreur — mais **elles ont
  augmenté, pas décru**, et il faut le dire : chaque écran ajouté depuis la
  phase 1 charge ses données dans un effet, ce qui est exactement le motif que
  la règle vise. La phase 8 n'en a ajouté aucune (les deux relevées dans ses
  propres crochets ont été corrigées à l'écriture), mais elle n'en a pas retiré
  non plus. Les corriger est une refactorisation à part entière — remonter le
  chargement dans les composants serveur — et le React Compiler restera hors
  d'atteinte tant qu'elles sont là.
- **`xlsx` porte une faille haute sans correctif** sur npm (pollution de
  prototype, ReDoS) : SheetJS ne publie plus sur le registre public. Papyrus ne
  fait qu'écrire des exports, l'exposition est faible — à remplacer en phase 5,
  quand les exports seront repris de toute façon.
