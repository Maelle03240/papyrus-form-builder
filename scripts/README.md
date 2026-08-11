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
