# Papyrus

Form builder de **Mooove**. Créer, publier et analyser des formulaires — avec
import depuis Tally.

Next.js 14 (App Router) · TypeScript strict · Tailwind · Supabase auto-hébergé ·
Cloudflare R2.

---

## Démarrer

```bash
npm install
cp .env.example .env.local   # puis remplir depuis Vaultwarden « MOOOVE IT »
npm run dev
```

L'application exige une connexion : il n'existe plus de mode local hors ligne.
Pour travailler en local, pointer `.env.local` sur le Supabase auto-hébergé
(`https://supabase.mooove.group`) — `http://localhost:3000/**` est déjà dans la
liste de redirections autorisées.

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production |
| `npm run typecheck` | Vérification TypeScript |
| `npm run lint` | ESLint |

`build` échoue en cas d'erreur TypeScript ou ESLint : c'est volontaire.

---

## Structure

```
app/            pages et routes API
  (auth)/       connexion, inscription
  (dashboard)/  espace connecté — formulaires, réponses, paramètres
  f/[slug]/     formulaires publics
  api/          routes serveur
components/
  builder/      canvas, palette, réglages, logique
  public/       vues répondant (défilement, sections, une-à-une)
  respondent/   champs côté répondant
  ui/           primitives (Button, Input, Modal, Toast…)
lib/
  auth/         contrôle d'accès (domaines autorisés)
  storage/      R2 (médias) et Supabase Storage (documents)
  store/        accès aux données
  tally/        client et convertisseur d'import
types/          types TypeScript — source de vérité
supabase/       migrations SQL
```

---

## Règles du projet

**Médias.** Images et vidéos vont sur **Cloudflare R2**, jamais dans Supabase
Storage ni en base. Tout envoi passe par `lib/storage/attachments-client.ts`,
qui route selon le type : média → R2, document → Supabase Storage. Ne pas
appeler un backend de stockage directement depuis un composant.

**Schéma base.** Toutes les tables vivent dans le schéma `papyrus`, pas
`public` — ce Supabase est partagé par une quinzaine d'applications. Le schéma
est fixé dans les clients Supabase ; les appels `.from('forms')` restent inchangés.

**Secrets.** Uniquement dans l'onglet Environment du service Easypanel, valeurs
issues de Vaultwarden. Jamais dans le dépôt, jamais préfixés `NEXT_PUBLIC_` pour
une clé serveur.

**RLS.** Une policy par commande, jamais `for all` : sur un `for all`, la clause
`USING` régit aussi `DELETE`.

**Identité visuelle.** Palette Mooove uniquement, via les tokens CSS de
`app/globals.css`. Jamais de couleur en dur, jamais d'Ambre et de Cyan dans le
même bloc visuel.

---

## Import Tally

**Paramètres → Intégrations.**

- **Avec clé API** — structure *et* réponses déjà collectées. La clé est chiffrée
  (AES-256-GCM) avant enregistrement et n'est jamais réaffichée en clair.
- **Avec un lien public** `tally.so/r/xxxx` — structure seule : l'API Tally
  n'expose pas les réponses sans authentification.

La logique conditionnelle Tally n'a pas d'équivalent transférable ; l'import le
signale au lieu de produire des règles approximatives.

---

## Accès et inscriptions

Connexion par **Google** ou par email/mot de passe.

Google accepte n'importe quel compte Google : le filtre est dans
**Paramètres → Accès**, où un super-administrateur définit les domaines email
autorisés. Le contrôle s'applique côté serveur, au retour du callback OAuth.

Le premier compte créé sur une instance neuve devient super-administrateur.

---

## Déploiement

Voir **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — variables d'environnement,
mise en service, configuration Google, invariants de sécurité.

Production : `https://papyrus.mooove.group` · Easypanel, projet `main`,
service `papyrus`.
