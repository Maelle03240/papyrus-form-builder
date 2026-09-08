# Papyrus — Déploiement

Application Next.js 14 déployée sur **Easypanel** (VPS Hostinger), adossée au
**Supabase auto-hébergé** du projet `main`. Les médias vont sur **Cloudflare R2**.

> Papyrus ne tourne plus sur Vercel. Le projet `papyrus-form-builder` doit être
> supprimé de Vercel une fois cette version en production (voir §7).

---

## 1. Architecture

| Élément | Emplacement |
|---|---|
| Application | Easypanel · projet `main` · service `papyrus` |
| Domaine | `https://papyrus.mooove.group` |
| Base de données | Supabase auto-hébergé — **schéma `papyrus`** |
| API Supabase | `https://supabase.mooove.group` |
| Images & vidéos | Cloudflare R2, bucket `mooove-media`, servi par `media.mooove.ltd` |
| Documents (PDF, DOCX…) | Supabase Storage, bucket `papyrus-documents` |
| Code | GitHub `Mooove-Platform/papyrus-form-builder-1` |
| Secrets | Vaultwarden `MOOOVE IT` → onglet Environment du service Easypanel |

### Pourquoi un schéma dédié

Le schéma `public` de ce Supabase héberge déjà une quinzaine d'applications
(`jobs`, `candidates`, `companies`, `blog_posts`…). Des tables nommées `forms`,
`teams` ou `profiles` y entreraient en collision. L'instance appliquait déjà la
convention d'un schéma par application (`club`) : Papyrus la suit.

Conséquence : `papyrus` doit figurer dans `PGRST_DB_SCHEMAS`, sinon PostgREST ne
sert rien et l'application ne voit aucune table. C'est déjà fait.

---

## 2. Variables d'environnement

À saisir dans l'onglet **Environment** du service Easypanel — et nulle part
ailleurs. Aucune de ces valeurs ne doit être commitée.

| Variable | Rôle |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://papyrus.mooove.group` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://supabase.mooove.group` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé `anon` (Vaultwarden) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé `service_role` — **serveur uniquement** |
| `R2_ENDPOINT` | `https://fa465697ac24fdc96729af850633e9d0.r2.cloudflarestorage.com` |
| `R2_BUCKET_NAME` | `mooove-media` |
| `R2_REGION` | `auto` |
| `R2_ACCESS_KEY_ID` | Vaultwarden |
| `R2_SECRET_ACCESS_KEY` | Vaultwarden — **serveur uniquement** |
| `R2_PUBLIC_BASE_URL` | `https://media.mooove.ltd` |
| `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` | `https://media.mooove.ltd` |
| `APP_ENCRYPTION_KEY` | Chiffre les secrets tiers en base (clés Tally, **clé d'API de l'assistant**, jetons Google) et signe les jetons d'accès aux formulaires protégés. `openssl rand -base64 32` |
| `IP_HASH_SALT` | Sel du hachage d'IP des réponses. `openssl rand -hex 16` |
| `RESEND_API_KEY` | *Optionnel* — sans lui, invitations et notifications de réponse ne partent pas |
| `NOTIFICATION_FROM_EMAIL` | *Optionnel* — expéditeur des notifications. Domaine vérifié Resend obligatoire |
| `GOOGLE_CLIENT_ID` | *Optionnel* — intégration Google Sheets (voir §5) |
| `GOOGLE_CLIENT_SECRET` | *Optionnel* — **serveur uniquement** |
| `GOOGLE_REDIRECT_URI` | *Optionnel* — déduit de `NEXT_PUBLIC_APP_URL` si absent |

Il n'y a **rien d'autre à faire** pour les variables `NEXT_PUBLIC_*` : sur un
build Dockerfile, Easypanel passe automatiquement chaque variable de l'onglet
Environment en `--build-arg`. Le `Dockerfile` déclare les `ARG` correspondants,
et Next.js peut donc les inliner dans le bundle navigateur au moment du build.

Corollaire utile : seules les quatre `NEXT_PUBLIC_*` sont déclarées en `ARG`.
Les clés serveur (`SUPABASE_SERVICE_ROLE_KEY`, `R2_SECRET_ACCESS_KEY`,
`APP_ENCRYPTION_KEY`, `IP_HASH_SALT`) sont bien transmises au build par
Easypanel, mais comme le Dockerfile ne les déclare pas, elles ne sont ni
utilisées ni gravées dans une couche de l'image. Ne pas ajouter d'`ARG` pour
elles : elles apparaîtraient alors dans l'historique de l'image.

⚠️ Sans `APP_ENCRYPTION_KEY`, l'assistant IA ne peut pas être configuré du tout :
l'écran de réglages le dit et refuse d'enregistrer une clé plutôt que de la
stocker en clair.

⚠️ Changer `APP_ENCRYPTION_KEY` après coup rend illisibles les clés Tally déjà
enregistrées ; les équipes concernées devront reconnecter Tally. Sans
`IP_HASH_SALT`, aucune IP n'est stockée du tout (choix volontaire : mieux vaut
rien qu'un hachage réversible).

---

## 3. Première mise en service

1. **Base de données** — appliquer `supabase/migrations/001_papyrus_baseline.sql` :
   ```bash
   scp supabase/migrations/001_papyrus_baseline.sql root@168.231.81.84:/tmp/
   ssh root@168.231.81.84 \
     'docker cp /tmp/001_papyrus_baseline.sql main_supabase-db-1:/tmp/ && \
      docker exec main_supabase-db-1 psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/001_papyrus_baseline.sql'
   ```
   Le script est idempotent : il peut être rejoué sans dommage.

   Puis, dans le même ordre, `supabase/migrations/002_form_settings_integrations.sql`
   — réglages par formulaire, réponses partielles, intégrations. Également
   idempotent. Il **recrée les vues `public_*`** : les appliquer dans le désordre
   remettrait `public_forms` dans son état d'origine, sans la colonne `settings`
   ni le calcul `is_closed`, et les formulaires clos redeviendraient des 404.

   Puis les suivantes, **dans l'ordre des numéros** — jusqu'à
   `011_hardening.sql`. Toutes se rejouent sans dommage. Deux remarques :

   - À partir de `009`, les appliquer avec **`-U supabase_admin`** et non
     `-U postgres` : `postgres` n'est pas propriétaire des tables et se voit
     refuser les `alter table`.
   - `011_hardening.sql` **retire à `anon` tout droit sur les tables** — le
     visiteur ne lit que les vues `public_*` — et ramène ceux de `authenticated`
     au niveau exact de ses policies. Après l'avoir appliquée, lancer
     `node scripts/rls-session-test.mjs` : c'est ce qui vérifie que le tableau de
     bord fonctionne encore et que rien ne s'est ouvert au passage.

2. **Exposer le schéma à PostgREST** — dans
   `/etc/easypanel/projects/main/supabase/code/supabase/code/.env` :
   ```
   PGRST_DB_SCHEMAS=public,storage,graphql_public,club,papyrus
   ```
   puis, **depuis ce répertoire** :
   ```bash
   docker compose -p main_supabase up -d --no-deps rest
   ```
   > `-p main_supabase` n'est pas optionnel. Sans lui, Compose déduit le nom de
   > projet du répertoire et démarre une **seconde pile en parallèle** — dont un
   > second PostgreSQL pointé sur le même répertoire de données que la
   > production, via bind mount. C'est arrivé une fois ; ne pas le refaire.

3. **Service Easypanel** — projet `main`, service `papyrus` :
   connecter le dépôt GitHub, laisser Easypanel utiliser le `Dockerfile` du
   dépôt, renseigner les variables du §2, ajouter le domaine
   `papyrus.mooove.group` (Caddy émet le certificat automatiquement).

4. **CORS R2** — `papyrus.mooove.group` doit figurer dans la politique CORS du
   bucket `mooove-media`, avec au minimum la méthode `PUT` et l'en-tête
   `content-type`. Sans cela, les envois échouent en 403 juste après la
   signature — ce qui ressemble à un bug applicatif mais n'en est pas un.

5. **Uptime Kuma** — ajouter un moniteur sur
   `https://papyrus.mooove.group/api/health`. Cette sonde vérifie que la base
   répond réellement, pas seulement que le process Node est vivant.

---

## 4. Authentification Google

Déjà configuré. Pour mémoire, la chaîne complète :

- **Google Cloud** → client OAuth « Web application »
  - Origine JavaScript autorisée : `https://papyrus.mooove.group`
  - URI de redirection autorisée : `https://supabase.mooove.group/auth/v1/callback`
    (l'URL de **Supabase**, pas celle de l'application)
- **Supabase** (`.env` du service) :
  ```
  API_EXTERNAL_URL=https://supabase.mooove.group
  GOOGLE_ENABLED=true
  GOOGLE_CLIENT_ID=…
  GOOGLE_SECRET=…
  ADDITIONAL_REDIRECT_URLS=https://papyrus.mooove.group/**,http://localhost:3000/**
  ```
  Les quatre lignes `GOTRUE_EXTERNAL_GOOGLE_*` du `docker-compose.yml` doivent
  être décommentées, puis `docker compose -p main_supabase up -d --no-deps auth`.

`API_EXTERNAL_URL` valait `http://localhost:8000`, ce qui rendait tout retour
OAuth impossible. `ADDITIONAL_REDIRECT_URLS` était vide, ce qui aurait fait
rejeter le retour vers Papyrus même avec Google correctement déclaré.

### Qui peut se connecter

Google accepte de connecter **n'importe quel compte Google**. Le filtre est
applicatif : **Paramètres → Accès** définit les domaines email autorisés, et le
contrôle s'exécute côté serveur dans `/auth/callback`. Un compte refusé est
déconnecté et supprimé immédiatement.

Le **premier compte créé** devient super-administrateur (sans quoi l'écran
d'administration serait inaccessible sur une instance neuve). Se connecter en
premier, puis ajouter `mooove.live` aux domaines autorisés.

---

## 5. Google Sheets — intégration des réponses

Distincte du §4 : celle-ci sert à **écrire dans les feuilles des utilisateurs**,
pas à les authentifier. Elle utilise son propre client OAuth, déclaré dans
Papyrus et non dans Supabase.

1. **Google Cloud** → activer les API **Google Sheets** et **Google Drive**.
2. Créer un client OAuth « Application Web » :
   - Origine JavaScript autorisée : `https://papyrus.mooove.group`
   - URI de redirection autorisée :
     `https://papyrus.mooove.group/api/integrations/google/callback`
     — au caractère près, sinon Google refuse l'échange du code.
3. Renseigner `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` dans Easypanel.
4. Écran de consentement : les scopes demandés sont `openid`, `email`,
   `.../auth/spreadsheets` et `.../auth/drive.file`. `spreadsheets` est un scope
   **sensible** : en mode « Production », Google exige une vérification. Tant que
   l'application reste en mode « Test » avec les comptes Mooove en testeurs, rien
   à faire.

`drive.file` est délibéré : il ne donne accès qu'aux fichiers créés par Papyrus.
C'est pourquoi la liste « feuille existante » ne montre que les feuilles créées
depuis Papyrus — une feuille tierce se rattache par son lien, l'écriture passant
alors par le scope `spreadsheets`. L'alternative, `drive.readonly`, est un scope
**restreint** : revue de sécurité annuelle payante par un auditeur agréé.

Sans ces variables, l'onglet Intégrations affiche « non configuré » et le reste
de l'application fonctionne normalement.

---

## 6. Sécurité — invariants à ne pas casser

- **`SUPABASE_SERVICE_ROLE_KEY` et `R2_SECRET_ACCESS_KEY` ne doivent jamais être
  préfixées `NEXT_PUBLIC_`.** Elles seraient inlinées dans le bundle navigateur.
- **Les réponses n'ont pas de policy `INSERT`.** Elles ne peuvent entrer que par
  `/api/submit/[slug]`, qui valide, limite le débit et hache l'IP. Rouvrir une
  policy d'insertion anonyme contournerait tous ces contrôles.
- **`access_password` ne sort jamais de la base.** La lecture publique passe par
  les vues `public_forms` / `public_fields` / `public_logic_rules`.
- **Les policies sont écrites par commande, jamais en `for all`.** Sur un
  `for all`, la clause `USING` régit aussi `DELETE` : c'est ce qui permettait à
  un visiteur anonyme de supprimer les champs de n'importe quel formulaire publié.
- **Le bucket `papyrus-documents` n'a pas de policy `INSERT`.** Tout passe par
  `/api/uploads/document`.
- **`google_credentials` n'a aucune policy RLS**, comme `tally_credentials` : le
  jeton de rafraîchissement chiffré n'est atteignable que par `service_role`.
- **Deux politiques `frame-ancestors`, pas une** (`next.config.mjs`).
  `/embed/…` est encadrable par n'importe quel site — c'est sa raison d'être.
  Tout le reste, tableau de bord compris, reste limité aux domaines Mooove :
  élargir la règle générale exposerait l'application au détournement de clic.
- **Un formulaire protégé n'envoie pas ses questions avant validation du mot de
  passe.** `getPublicForm` renvoie une enveloppe vide ; le contenu ne sort que
  par `/api/forms/access`, qui délivre un jeton signé exigé ensuite par
  `/api/submit/[slug]`. Charger les champs « puis masquer l'écran » suffirait à
  contourner la protection depuis les outils de développement.

---

## 7. Limites connues

- Le **rate limiting est en mémoire du processus** (`lib/rate-limit.ts`). Adapté
  à un conteneur unique. Si Papyrus est un jour répliqué, le remplacer par un
  compteur Redis — l'interface du module ne changera pas.
- Les **anciennes images encodées en base64** dans les formulaires existants
  continuent de s'afficher. Le script `scripts/migrate-media-to-r2.ts` les
  déplace vers R2 ; il se lance à la demande, jamais automatiquement.
- La **logique conditionnelle Tally** n'est pas transférable : l'import le
  signale explicitement plutôt que de produire des règles approximatives.
- La **durée de conservation des réponses est appliquée paresseusement** : la
  purge se déclenche à chaque nouvelle réponse et à l'enregistrement de l'onglet
  Paramètres. Papyrus n'a pas d'ordonnanceur ; un formulaire qui ne reçoit plus
  rien ne se purge donc plus. Si la conformité l'exige, ajouter un `pg_cron` sur
  `papyrus.submissions`.
- Un **formulaire protégé par mot de passe intégré en iframe** fonctionne : le
  jeton d'accès circule dans le corps des requêtes, pas dans un cookie tiers.
  En revanche le mot de passe est redemandé à chaque chargement de la page hôte.

---

## 8. Sortie de Vercel

Une fois `papyrus.mooove.group` vérifié en production :

1. Vercel → projet `papyrus-form-builder` → Settings → **Delete Project**.
2. Retirer l'entrée correspondante de `infrastructure-inventory.md` (§2).
3. Vérifier qu'aucun DNS ne pointe encore vers Vercel pour ce produit.

L'ancienne base Supabase hébergée (projet `tetejylfaantwhbqaqtr`) n'est plus
utilisée. Son mot de passe figure en clair dans l'historique Git du dépôt
(commit `41ad801`, fichier `.env.example`) : le considérer comme compromis et
s'assurer qu'il n'a été réutilisé nulle part ailleurs.
