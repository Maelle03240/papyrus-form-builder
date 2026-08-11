#!/bin/bash
# Parcours réels jamais exécutés jusqu'ici : soumission d'une réponse de bout en
# bout, et téléversement effectif sur R2 avec les identifiants de production.

ENVF=/etc/easypanel/projects/main/supabase/code/supabase/code/.env
APP="https://papyrus.mooove.group"
DB="docker exec main_supabase-db-1 psql -U postgres -d postgres -tAc"

pass=0; fail=0
check() {
  if [ "$2" = "$3" ]; then echo "  ok   $1"; pass=$((pass+1));
  else echo "  FAIL $1 — attendu [$2], obtenu [$3]"; fail=$((fail+1)); fi
}

FORM=44444444-4444-4444-4444-444444444444
TEAM=11111111-1111-1111-1111-111111111111
F_NAME=55555555-5555-5555-5555-555555555555
F_MAIL=66666666-6666-6666-6666-666666666666

echo "== Préparation : formulaire publié avec un champ requis et un email =="
$DB "insert into papyrus.teams (id,name) values ('$TEAM','E2E') on conflict (id) do nothing;" >/dev/null
$DB "insert into papyrus.forms (id,team_id,title,slug,status,unique_email) values ('$FORM','$TEAM','E2E','e2e-test-form','published',true) on conflict (id) do update set status='published', unique_email=true;" >/dev/null
$DB "insert into papyrus.fields (id,form_id,type,label,field_order,required) values ('$F_NAME','$FORM','short_text','{\"fr\":\"Nom\"}',0,true) on conflict (id) do nothing;" >/dev/null
$DB "insert into papyrus.fields (id,form_id,type,label,field_order,required) values ('$F_MAIL','$FORM','email','{\"fr\":\"Email\"}',1,true) on conflict (id) do nothing;" >/dev/null
$DB "delete from papyrus.submissions where form_id='$FORM';" >/dev/null

echo
echo "== 1. Le formulaire public est servi =="
check "GET /f/e2e-test-form" "200" "$(curl -s -m 25 -o /dev/null -w '%{http_code}' $APP/f/e2e-test-form)"

echo
echo "== 2. Champ requis manquant → 422, rien en base =="
R=$(curl -s -m 25 -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d "{\"responses\":{\"$F_NAME\":\"\"}}" $APP/api/submit/e2e-test-form)
check "statut 422" "422" "$(echo "$R" | tail -1)"
check "aucune ligne écrite" "0" "$($DB "select count(*) from papyrus.submissions where form_id='$FORM';")"

echo
echo "== 3. Soumission valide → 200 et une ligne =="
R=$(curl -s -m 25 -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d "{\"responses\":{\"$F_NAME\":\"Keven\",\"$F_MAIL\":\"KEVEN@Mooove.live\",\"champ_inconnu\":\"injection\"}}" \
  $APP/api/submit/e2e-test-form)
check "statut 200" "200" "$(echo "$R" | tail -1)"
check "une réponse enregistrée" "1" "$($DB "select count(*) from papyrus.submissions where form_id='$FORM';")"

echo
echo "== 4. La clé inconnue a bien été filtrée =="
check "champ_inconnu absent" "0" "$($DB "select count(*) from papyrus.submissions where form_id='$FORM' and responses ? 'champ_inconnu';")"
check "réponse légitime conservée" "1" "$($DB "select count(*) from papyrus.submissions where form_id='$FORM' and responses->>'$F_NAME'='Keven';")"

echo
echo "== 5. Email normalisé en minuscules (option « un seul envoi ») =="
check "respondent_email = keven@mooove.live" "1" "$($DB "select count(*) from papyrus.submissions where form_id='$FORM' and respondent_email='keven@mooove.live';")"

echo
echo "== 6. Doublon refusé =="
R=$(curl -s -m 25 -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d "{\"responses\":{\"$F_NAME\":\"Autre\",\"$F_MAIL\":\"keven@mooove.live\"}}" \
  $APP/api/submit/e2e-test-form)
check "statut 409" "409" "$(echo "$R" | tail -1)"
check "toujours une seule ligne" "1" "$($DB "select count(*) from papyrus.submissions where form_id='$FORM';")"

echo
echo "== 7. IP hachée, jamais en clair =="
check "ip_hash renseigné" "1" "$($DB "select count(*) from papyrus.submissions where form_id='$FORM' and ip_hash is not null and length(ip_hash)=64;")"

echo
echo "== 8. check-duplicate reflète l'état réel =="
D=$(curl -s -m 25 -X POST -H 'Content-Type: application/json' \
  -d "{\"form_id\":\"$FORM\",\"email\":\"keven@mooove.live\"}" $APP/api/check-duplicate)
check "duplicate = true" "1" "$(echo "$D" | grep -c '"duplicate":true')"

echo
echo "== 9. Formulaire fermé → refus =="
$DB "update papyrus.forms set closes_at=now()-interval '1 day' where id='$FORM';" >/dev/null
check "statut 403" "403" "$(curl -s -m 25 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"responses\":{\"$F_NAME\":\"x\"}}" $APP/api/submit/e2e-test-form)"
check "n'apparaît plus dans public_forms" "0" "$($DB "select count(*) from papyrus.public_forms where id='$FORM';")"

echo
echo "== 10. Cloudflare R2 — téléversement réel avec les identifiants de prod =="
# Ne PAS appeler GetBucketCors ici : le jeton R2 est limité aux objets, la
# lecture de la configuration du bucket exige un jeton d'administration. Une
# version antérieure de ce test enchaînait les deux appels, et l'échec du
# second masquait la réussite du premier — on croyait l'envoi cassé alors qu'il
# fonctionnait. La CORS se vérifie par un préflight, comme le ferait un navigateur.
CT=$(docker ps --format '{{.Names}}' | grep '^main_papyrus' | head -1)
R2=$(docker exec "$CT" node -e "
const {S3Client,PutObjectCommand}=require('/app/node_modules/@aws-sdk/client-s3');
const c=new S3Client({region:'auto',endpoint:process.env.R2_ENDPOINT,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}});
const key='papyrus/selftest/'+Date.now()+'.txt';
c.send(new PutObjectCommand({Bucket:process.env.R2_BUCKET_NAME,Key:key,Body:'ok',ContentType:'text/plain'}))
 .then(()=>console.log('UPLOAD_OK|'+key))
 .catch(e=>console.log('ERR|'+e.name));
" 2>&1 | grep -E '^(UPLOAD_OK|ERR)' | tail -1)
check "téléversement R2 réussi" "1" "$(echo "$R2" | grep -c 'UPLOAD_OK')"

KEY=$(echo "$R2" | cut -d'|' -f2)
if [ -n "$KEY" ]; then
  check "objet lisible via media.mooove.ltd" "200" "$(curl -s -m 20 -o /dev/null -w '%{http_code}' "https://media.mooove.ltd/$KEY")"
fi

# Préflight identique à celui qu'émet le navigateur avant un PUT présigné.
PF=$(curl -s -i -m 20 -X OPTIONS "https://fa465697ac24fdc96729af850633e9d0.r2.cloudflarestorage.com/mooove-media/probe.png" \
  -H "Origin: $APP" -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-type')
check "CORS autorise l'origine"      "1" "$(echo "$PF" | grep -ci "access-control-allow-origin: $APP")"
check "CORS autorise la méthode PUT" "1" "$(echo "$PF" | grep -i 'access-control-allow-methods' | grep -c 'PUT')"

echo
echo "== Nettoyage =="
$DB "delete from papyrus.teams where id='$TEAM';" >/dev/null
echo "  fait"
echo
echo "===== $pass réussis, $fail échoués ====="
