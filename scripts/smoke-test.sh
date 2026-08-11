#!/bin/bash
# Vérification en conditions réelles contre le déploiement de production.
# Objectif : prouver que les correctifs de sécurité tiennent vraiment, et
# qu'aucune route ne renvoie 500 ou n'expose ce qu'elle ne devrait pas.

APP="https://papyrus.mooove.group"
SB="https://supabase.mooove.group"
ANON=$(grep '^ANON_KEY=' /etc/easypanel/projects/main/supabase/code/supabase/code/.env | cut -d= -f2-)

pass=0; fail=0
check() { # check <libellé> <attendu> <obtenu>
  if [ "$2" = "$3" ]; then echo "  ok   $1 ($3)"; pass=$((pass+1));
  else echo "  FAIL $1 — attendu $2, obtenu $3"; fail=$((fail+1)); fi
}
code() { curl -s -m 20 -o /dev/null -w '%{http_code}' "$@"; }

echo "== 1. Pages publiques =="
check "/ (redirige)"            "307" "$(code "$APP/")"
check "/login"                  "200" "$(code "$APP/login")"
check "/signup"                 "200" "$(code "$APP/signup")"
check "/api/health"             "200" "$(code "$APP/api/health")"
check "/f/inexistant → 404"     "404" "$(code "$APP/f/ce-slug-nexiste-pas")"

echo "== 2. Routes protégées sans session (doivent refuser, pas planter) =="
check "GET /api/teams"          "401" "$(code "$APP/api/teams")"
check "GET /api/members"        "401" "$(code "$APP/api/members?teamId=00000000-0000-0000-0000-000000000000")"
check "GET /api/admin/settings" "401" "$(code "$APP/api/admin/settings")"
check "POST /api/uploads/presign" "401" "$(code -X POST -H 'Content-Type: application/json' -d '{"contentType":"image/png","size":100,"context":"builder"}' "$APP/api/uploads/presign")"
check "POST /api/integrations/tally/import" "401" "$(code -X POST -H 'Content-Type: application/json' -d '{"teamId":"00000000-0000-0000-0000-000000000000","source":"abc"}' "$APP/api/integrations/tally/import")"
check "POST invite (relais email)" "401" "$(code -X POST -H 'Content-Type: application/json' -d '{"email":"x@y.z"}' "$APP/api/workspaces/00000000-0000-0000-0000-000000000000/invite")"
check "POST /api/generate-form" "401" "$(code -X POST "$APP/api/generate-form")"

echo "== 3. Validation d'entrée (doit répondre 4xx, jamais 500) =="
check "presign corps invalide"  "400" "$(code -X POST -H 'Content-Type: application/json' -d '{"nope":1}' "$APP/api/uploads/presign")"
check "submit JSON cassé"       "400" "$(code -X POST -H 'Content-Type: application/json' -d 'pas-du-json' "$APP/api/submit/x")"
check "submit slug inconnu"     "404" "$(code -X POST -H 'Content-Type: application/json' -d '{"responses":{}}' "$APP/api/submit/slug-inconnu")"
check "check-duplicate invalide" "400" "$(code -X POST -H 'Content-Type: application/json' -d '{"form_id":"pas-un-uuid","email":"a@b.c"}' "$APP/api/check-duplicate")"

echo "== 4. Sécurité RLS — surface visible par un visiteur anonyme =="
# Attention : sous PostgREST, une lecture bloquée par la RLS renvoie « 200 [] »
# et une suppression sans ligne visible renvoie « 204 ». Le code de statut ne
# prouve donc rien. Ici on ne teste que ce qui doit être franchement refusé
# (privilège de table absent) ; la vraie vérification, sur données réelles,
# est dans rls-test.sh.
check "anon lit public_forms → ok"       "200" "$(code -H "apikey: $ANON" -H 'Accept-Profile: papyrus' "$SB/rest/v1/public_forms?select=id&limit=1")"
check "anon insère une submission → refusé" "401" "$(code -X POST -H "apikey: $ANON" -H 'Content-Profile: papyrus' -H 'Content-Type: application/json' -d '{"form_id":"00000000-0000-0000-0000-000000000000","responses":{}}' "$SB/rest/v1/submissions")"
check "anon lit les clés Tally → refusé"  "401" "$(code -H "apikey: $ANON" -H 'Accept-Profile: papyrus' "$SB/rest/v1/tally_credentials?select=encrypted_api_key")"

echo "== 5. Fuite de colonne : access_password ne doit jamais sortir =="
LEAK=$(curl -s -m 20 -H "apikey: $ANON" -H 'Accept-Profile: papyrus' "$SB/rest/v1/public_forms?select=*&limit=1" | grep -c 'access_password')
check "access_password absent de public_forms" "0" "$LEAK"

echo "== 6. En-têtes de sécurité =="
H=$(curl -s -m 20 -D - -o /dev/null "$APP/login")
check "CSP présente"            "1" "$(echo "$H" | grep -ci 'content-security-policy')"
check "HSTS présente"           "1" "$(echo "$H" | grep -ci 'strict-transport-security')"
check "nosniff présente"        "1" "$(echo "$H" | grep -ci 'x-content-type-options')"
check "pas de X-Powered-By"     "0" "$(echo "$H" | grep -ci 'x-powered-by')"

echo
echo "===== $pass réussis, $fail échoués ====="
