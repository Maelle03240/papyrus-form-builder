# CLAUDE.md — Instructions agent pour Papyrus

## Contexte

**Papyrus** — form builder SaaS de Mooove.
Next.js 14 (App Router) · TypeScript strict · Tailwind · Supabase auto-hébergé ·
Cloudflare R2 · Framer Motion · @dnd-kit · Recharts · React Hook Form + Zod.

Déploiement : Easypanel (projet `main`, service `papyrus`) sur le VPS Hostinger.
Voir `docs/DEPLOYMENT.md`.

---

## Règles non négociables

### Stockage des médias
Images et vidéos → **Cloudflare R2**. Jamais Supabase Storage, jamais de data URL
en base. Tout envoi passe par `lib/storage/attachments-client.ts`, qui route
selon le type (média → R2, document → Supabase Storage). Ne jamais appeler un
backend de stockage directement depuis un composant.

### Schéma base de données
Toutes les tables vivent dans le schéma **`papyrus`**, pas `public` : ce Supabase
est partagé par une quinzaine d'applications. Le schéma est fixé dans les
clients (`lib/supabase/*`) ; les appels `.from('forms')` n'ont pas à changer.
Toute nouvelle table doit être ajoutée à une migration dans `supabase/migrations/`.

### Secrets
Uniquement dans l'onglet Environment du service Easypanel, valeurs issues de
Vaultwarden `MOOOVE IT`. Jamais dans le dépôt. Ne jamais préfixer `NEXT_PUBLIC_`
une clé serveur — elle serait inlinée dans le bundle navigateur.
Toute lecture d'environnement passe par `lib/env.ts`.

### Sécurité — invariants
- Policies RLS **par commande**, jamais `for all` : sur un `for all`, la clause
  `USING` régit aussi `DELETE`.
- `submissions` n'a **pas** de policy `INSERT` : les réponses n'entrent que par
  `/api/submit/[slug]`, qui valide, limite le débit et hache l'IP.
- La lecture publique passe par les vues `public_forms` / `public_fields` /
  `public_logic_rules`, qui n'exposent pas `access_password`.
- Toute route API qui utilise `createAdminClient()` (service_role) **doit**
  vérifier elle-même les droits de l'appelant : la RLS n'y protège plus rien.
- Une route API ne renvoie jamais le message d'erreur brut de Postgres au client.

### TypeScript
Zéro `any` nouveau, zéro `@ts-ignore`. Les types viennent de `types/index.ts`.
`npm run build` échoue sur toute erreur TypeScript ou ESLint — ne pas remettre
`ignoreBuildErrors`.

### Identité visuelle Mooove
Couleurs via les tokens CSS de `app/globals.css`, jamais en dur.

```
--mooove-navy     #052139   principale / autorité
--mooove-cyan     #2AC2DE   CTA / énergie
--mooove-amber    #F6923E   chaleur — rare
--mooove-electric #3C5EAB   badges « publié »
--mooove-ice      #EFF9FE   fond secondaire
--mooove-sky      #C7EAFB   séparateurs
```

Dosage : 75 % Navy + blanc · 15 % Cyan · 5 % Blue & Sky · 5 % Ambre.
**Jamais d'Ambre et de Cyan dans le même bloc visuel.**

Typographie : une seule famille (Aktiv Grotesk, substituée par DM Sans), deux
poids. Titres en Bold. Coins : `rounded` 8px (inputs, badges) · `rounded-xl`
12px (boutons, panneaux) · `rounded-2xl` 20px (cards).

### Structure
```
app/  pages et routes API      components/  builder · public · respondent · templates · ui · layout
lib/  logique métier           types/  source de vérité des types
supabase/  migrations SQL uniquement
```
Avant de créer un élément d'interface, vérifier `components/ui/`.

### Catalogue de modèles
Les modèles Mooove vivent dans `lib/templates/catalog/` — un fichier JSON par
modèle, versionné. `lib/templates/generated.ts` est **auto-généré** : ne jamais
l'éditer à la main, relancer `npm run templates:build`. Il porte
`import 'server-only'`, ce qui empêche structurellement les ~600 Ko du catalogue
d'entrer dans un bundle navigateur : le client ne reçoit que l'index, via
`/api/templates`.

Après toute modification d'un fichier du catalogue :
```bash
npm run templates:build && npm run templates:check
```
`lib/templates/types.ts` est une exception assumée à la règle « types dans
`types/` » : ces types décrivent un format de fichier de contenu, pas le modèle
de données de l'application.

---

## Méthode

1. **Lire avant d'écrire.** Ne jamais supposer le contenu d'un fichier.
2. **Scope minimal.** Un bug hors périmètre se signale, il ne se corrige pas sans accord.
3. **Une question précise** plutôt qu'une hypothèse, si la demande est ambiguë.
4. Après une tâche : ce qui a été fait, les fichiers touchés, les points à tester.

---

## Ce qu'il ne faut pas refaire

- **`docker compose` sans `-p main_supabase`** dans le répertoire Supabase : une
  seconde pile démarre en parallèle, avec un second PostgreSQL sur le même
  répertoire de données que la production.
- **Réintroduire un « mode local »** : l'ancien `NEXT_PUBLIC_LOCAL_MODE`
  désactivait l'authentification dans le middleware. Une variable mal renseignée
  suffisait à publier l'application entière.
- **Stocker un fichier en base**, sous quelque forme que ce soit.
