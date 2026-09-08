# Scripts

## Vérification

Trois scripts, à exécuter **depuis le VPS** (ils ont besoin d'un accès au
conteneur Postgres et à la clé `anon` du service Supabase) :

```bash
scp scripts/*.sh root@168.231.81.84:/root/papyrus/
ssh root@168.231.81.84 'bash /root/papyrus/smoke-test.sh'
ssh root@168.231.81.84 'bash /root/papyrus/rls-test.sh'
ssh root@168.231.81.84 'bash /root/papyrus/e2e-test.sh'
```

| Script | Ce qu'il vérifie |
|---|---|
| `smoke-test.sh` | Pages publiques, refus 401 sur chaque route protégée, validation d'entrée (jamais de 500), en-têtes de sécurité |
| `rls-test.sh` | La RLS **sur données réelles** : crée un formulaire publié, tente de le lire, le modifier et le supprimer en anonyme, et vérifie que la donnée survit |
| `e2e-test.sh` | Le parcours de réponse complet (champ requis, filtrage des clés inconnues, unicité par email, hachage d'IP, formulaire clos) et le téléversement R2 réel + préflight CORS |

Tous nettoient les données qu'ils créent.

### Et le quatrième, depuis le poste de développement

```bash
node scripts/rls-session-test.mjs
```

`rls-test.sh` couvre le visiteur anonyme ; il manquait l'autre moitié — ce qu'un
**membre connecté** peut et ne peut pas faire. Ce script lit `.env.local`, crée
un compte d'essai, le rattache à une équipe existante, puis fait par PostgREST
exactement ce que le navigateur fait : lire ses formulaires, créer un projet,
inviter un collègue. Puis ce qu'il ne doit pas pouvoir faire : écrire une réponse
à la main, lire une clé d'API, écrire les réglages de l'instance. Il supprime
ensuite tout ce qu'il a créé.

Écrit pour la phase 8, où il a servi à vérifier la migration `011_hardening` —
et où il a confirmé qu'inviter un collègue échouait, faute des trois policies
d'écriture sur `team_invitations`.

## La revue complète

```bash
node scripts/audit-setup.mjs .audit/session.json
node scripts/audit-form.mjs  .audit/session.json .audit/form.json

E2E_BASE_URL=http://localhost:3100 E2E_SESSION_FILE=.audit/session.json E2E_AUDIT_SLUG=<le slug affiché> E2E_AUDIT_FORM=<l'identifiant affiché> E2E_AUDIT_PROJECT=<celui du projet>   npx playwright test tests/e2e/audit.spec.ts

node scripts/audit-teardown.mjs .audit/session.json .audit/form.json
```

`tests/e2e/audit.spec.ts` traverse **tout** : chaque écran du tableau de bord,
chaque onglet d'un projet et d'un formulaire, le constructeur, l'aperçu, les
trois modes d'affichage, la publication, la réponse publique, et le retour de
cette réponse dans l'onglet Réponses. Chaque page est écoutée : une erreur de
console ou une exception non rattrapée fait échouer le test qui l'a provoquée.

Le formulaire de revue porte **les vingt-sept types de champ**, deux sections,
une règle de logique et de la tarification. C'est en le traversant écran par
écran qu'on a trouvé le séparateur promu en question numérotée, le champ caché
devenu un écran vide, l'intitulé affiché deux fois, et le message « ajoutez-en
dans le panneau de droite » — destiné à l'auteur — montré au répondant sur un
formulaire publié.

Rien de tout cela n'est visible autrement : le typage est satisfait, les tests
unitaires passent, et l'écran s'affiche.

L'espace de travail créé est neuf et vide ; `audit-teardown.mjs` supprime le
projet, l'équipe et le compte d'essai.

---

### Pourquoi sur données réelles

Sous PostgREST, une lecture refusée par la RLS renvoie `200 []` et une
suppression qui ne voit aucune ligne renvoie `204`. Un test qui se contente de
lire le code de statut conclut donc à une faille là où il n'y en a pas — et,
plus grave, ne détecterait pas une vraie régression. `rls-test.sh` insère de la
donnée, tente l'attaque, puis vérifie en base que la donnée est intacte.

### À lancer après chaque déploiement

Les trois scripts ont attrapé des régressions que ni `tsc` ni `next lint` ni
`next build` ne voient — notamment une page publique qui répondait 404 pour tout
le monde après un durcissement de la RLS, parce que la requête visait encore une
table devenue inaccessible au rôle anonyme.

---

## Migration

`migrate-media-to-r2.ts` — déplace vers Cloudflare R2 les images encodées en
base64 dans les formulaires créés avant le passage à R2.

```bash
npx tsx scripts/migrate-media-to-r2.ts --dry-run   # inventaire
npx tsx scripts/migrate-media-to-r2.ts             # migration
```

Ré-exécutable sans risque : une valeur déjà migrée n'est plus une data URL.
