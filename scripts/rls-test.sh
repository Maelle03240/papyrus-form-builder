#!/bin/bash
# Vérifie la RLS sur des DONNÉES RÉELLES, pas sur des codes de statut.
#
# Sous PostgREST, une lecture refusée par la RLS renvoie « 200 [] » et une
# suppression qui ne voit aucune ligne renvoie « 204 ». Le code de statut ne
# prouve donc rien : seule compte la survie de la donnée.

ENVF=/etc/easypanel/projects/main/supabase/code/supabase/code/.env
SB="https://supabase.mooove.group"
ANON=$(grep '^ANON_KEY=' $ENVF | cut -d= -f2-)
DB="docker exec main_supabase-db-1 psql -U postgres -d postgres -tAc"

pass=0; fail=0
check() {
  if [ "$2" = "$3" ]; then echo "  ok   $1"; pass=$((pass+1));
  else echo "  FAIL $1 — attendu [$2], obtenu [$3]"; fail=$((fail+1)); fi
}

echo "== Préparation : une équipe, un formulaire publié, un champ =="
$DB "insert into papyrus.teams (id,name) values ('11111111-1111-1111-1111-111111111111','RLS Test') on conflict (id) do nothing;" >/dev/null
$DB "insert into papyrus.forms (id,team_id,title,slug,status,access_password) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Test RLS','rls-test-form','published','SECRET123') on conflict (id) do update set status='published', access_password='SECRET123';" >/dev/null
$DB "insert into papyrus.fields (id,form_id,type,label,field_order) values ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222','short_text','{\"fr\":\"Question test\"}',0) on conflict (id) do nothing;" >/dev/null
echo "  champs en base : $($DB "select count(*) from papyrus.fields where id='33333333-3333-3333-3333-333333333333';")"

echo
echo "== 1. Lecture anonyme de la table forms =="
BODY=$(curl -s -m 20 -H "apikey: $ANON" -H 'Accept-Profile: papyrus' "$SB/rest/v1/forms?select=id,access_password")
echo "  réponse brute : ${BODY:0:120}"
check "aucune ligne renvoyée" "[]" "$BODY"

echo
echo "== 2. Le mot de passe du formulaire ne fuit nulle part =="
PUB=$(curl -s -m 20 -H "apikey: $ANON" -H 'Accept-Profile: papyrus' "$SB/rest/v1/public_forms?select=*&slug=eq.rls-test-form")
check "public_forms ne contient pas SECRET123" "0" "$(echo "$PUB" | grep -c 'SECRET123')"
check "public_forms expose bien le formulaire" "1" "$(echo "$PUB" | grep -c 'rls-test-form')"
check "requires_password vaut true" "1" "$(echo "$PUB" | grep -c '"requires_password":true')"

echo
echo "== 3. SUPPRESSION anonyme des champs — la faille d'origine =="
curl -s -m 20 -o /dev/null -X DELETE -H "apikey: $ANON" -H 'Content-Profile: papyrus' \
  "$SB/rest/v1/fields?id=eq.33333333-3333-3333-3333-333333333333"
check "le champ a survécu" "1" "$($DB "select count(*) from papyrus.fields where id='33333333-3333-3333-3333-333333333333';")"

echo
echo "== 4. MODIFICATION anonyme des champs =="
curl -s -m 20 -o /dev/null -X PATCH -H "apikey: $ANON" -H 'Content-Profile: papyrus' \
  -H 'Content-Type: application/json' -d '{"label":{"fr":"PIRATÉ"}}' \
  "$SB/rest/v1/fields?id=eq.33333333-3333-3333-3333-333333333333"
check "le libellé est intact" "1" "$($DB "select count(*) from papyrus.fields where id='33333333-3333-3333-3333-333333333333' and label->>'fr'='Question test';")"

echo
echo "== 5. Suppression anonyme du formulaire lui-même =="
curl -s -m 20 -o /dev/null -X DELETE -H "apikey: $ANON" -H 'Content-Profile: papyrus' \
  "$SB/rest/v1/forms?id=eq.22222222-2222-2222-2222-222222222222"
check "le formulaire a survécu" "1" "$($DB "select count(*) from papyrus.forms where id='22222222-2222-2222-2222-222222222222';")"

echo
echo "== 6. Annuaire des profils =="
PROF=$(curl -s -m 20 -H "apikey: $ANON" -H 'Accept-Profile: papyrus' "$SB/rest/v1/profiles?select=email")
echo "  réponse brute : ${PROF:0:120}"
check "aucun email exposé" "[]" "$PROF"

echo
echo "== 7. Écriture anonyme d'une réponse (doit passer par l'API) =="
curl -s -m 20 -o /dev/null -X POST -H "apikey: $ANON" -H 'Content-Profile: papyrus' \
  -H 'Content-Type: application/json' \
  -d '{"form_id":"22222222-2222-2222-2222-222222222222","responses":{"x":"1"}}' \
  "$SB/rest/v1/submissions"
check "aucune réponse insérée" "0" "$($DB "select count(*) from papyrus.submissions where form_id='22222222-2222-2222-2222-222222222222';")"

echo
echo "== Nettoyage =="
$DB "delete from papyrus.teams where id='11111111-1111-1111-1111-111111111111';" >/dev/null
echo "  fait"

echo
echo "===== $pass réussis, $fail échoués ====="
