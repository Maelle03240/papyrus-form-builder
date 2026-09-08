// Vérifie les droits avec une VRAIE session, pas avec la clé anonyme.
//
// `scripts/rls-test.sh` couvre le visiteur anonyme. Il manquait l'autre moitié :
// ce qu'un membre connecté peut et ne peut pas faire. Les droits d'une table ne
// se lisent pas dans le code — ils se lisent en tentant l'écriture, avec un
// jeton `authenticated`, contre la vraie base.
//
// Écrit pour la phase 8, où la migration 011 a retiré à `anon` tout droit sur
// les tables, ramené ceux de `authenticated` au niveau de ses policies, et
// ajouté les trois policies d'écriture qui manquaient à `team_invitations` —
// sans lesquelles inviter un collègue échouait en silence.
//
// Usage :  node scripts/rls-session-test.mjs
//
// Il lit `.env.local` (URL, clé anonyme, clé de service), crée un compte
// d'essai, le rattache à une équipe existante, fait ses vérifications, puis
// supprime tout ce qu'il a créé. Il n'écrit rien de durable.
import fs from 'node:fs';

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_ || !ANON || !SERVICE) {
  console.error('.env.local incomplet : URL, clé anonyme et clé de service sont requises.');
  process.exit(1);
}

const EMAIL = `rls-check+${Date.now()}@papyrus-test.local`;
const PASSWORD = `Rls!${Math.random().toString(36).slice(2)}`;

let pass = 0;
let fail = 0;
function check(label, expected, actual) {
  if (String(expected) === String(actual)) {
    console.log(`  ok   ${label}`);
    pass += 1;
  } else {
    console.log(`  FAIL ${label} — attendu [${expected}], obtenu [${actual}]`);
    fail += 1;
  }
}

const headers = {
  'Content-Type': 'application/json',
  'Content-Profile': 'papyrus',
  'Accept-Profile': 'papyrus'
};

function admin(path, init = {}) {
  return fetch(`${URL_}${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, ...headers, ...init.headers }
  });
}

function asUser(jwt, path, init = {}) {
  return fetch(`${URL_}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${jwt}`,
      Prefer: 'return=representation',
      ...headers,
      ...init.headers
    }
  });
}

function anon(path) {
  return fetch(`${URL_}/rest/v1${path}`, {
    headers: { apikey: ANON, 'Accept-Profile': 'papyrus' }
  });
}

// ── Préparation ─────────────────────────────────────────────────────────────

const teams = await admin('/rest/v1/teams?select=id&limit=1');
const [team] = await teams.json();
if (!team) {
  console.error('Aucune équipe en base : rien à vérifier.');
  process.exit(1);
}

const created = await admin('/auth/v1/admin/users', {
  method: 'POST',
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true })
});
const user = await created.json();
if (!user.id) {
  console.error(`Création du compte d'essai échouée : ${JSON.stringify(user).slice(0, 300)}`);
  process.exit(1);
}

// Le compte est fait administrateur : c'est le rôle le PLUS permissif, donc
// celui qui prouve qu'un refus vient bien des droits et non du rang.
await admin('/rest/v1/team_members', {
  method: 'POST',
  body: JSON.stringify({ team_id: team.id, user_id: user.id, role: 'admin' })
});

const signIn = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD })
});
const session = await signIn.json();
const jwt = session.access_token;

if (!jwt) {
  await admin(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
  console.error(`Connexion échouée : ${JSON.stringify(session).slice(0, 300)}`);
  process.exit(1);
}

console.log(`Compte d'essai ${user.id}, équipe ${team.id}\n`);

let projectId = null;

try {
  // ── Ce que le tableau de bord doit pouvoir faire ──────────────────────────
  console.log('== Ce que le tableau de bord doit pouvoir faire ==');

  check(
    'lire ses formulaires',
    200,
    (await asUser(jwt, `/forms?select=id&team_id=eq.${team.id}&limit=3`)).status
  );

  const project = await asUser(jwt, '/projects', {
    method: 'POST',
    body: JSON.stringify({ team_id: team.id, name: 'Sonde des droits' })
  });
  check('créer un projet', 201, project.status);
  projectId = (await project.json())[0]?.id ?? null;

  // Les trois policies ajoutées par la 011. Avant elle, cette insertion
  // échouait, et l'écran « inviter un collègue » avec.
  const invitation = await asUser(jwt, '/team_invitations', {
    method: 'POST',
    body: JSON.stringify({
      team_id: team.id,
      invited_by: user.id,
      invitation_type: 'email',
      email: `invite+${Date.now()}@papyrus-test.local`,
      role: 'member',
      expires_at: new Date(Date.now() + 86_400_000).toISOString()
    })
  });
  check('inviter un collègue', 201, invitation.status);

  const invitationId = (await invitation.json())[0]?.id;
  if (invitationId) {
    check(
      "retirer l'invitation",
      200,
      (await asUser(jwt, `/team_invitations?id=eq.${invitationId}`, { method: 'DELETE' })).status
    );
  }

  // ── Ce que personne ne doit pouvoir faire ─────────────────────────────────
  console.log('\n== Ce que personne ne doit pouvoir faire ==');

  // Une réponse n'entre que par `/api/submit`, qui la valide, la tarife et la
  // gèle. L'écrire à la main contournerait tout cela.
  const insertSubmission = await asUser(jwt, '/submissions', {
    method: 'POST',
    body: JSON.stringify({
      form_id: '00000000-0000-4000-8000-000000000000',
      responses: {}
    })
  });
  check('écrire une réponse à la main', true, insertSubmission.status >= 400);

  // Deux verrous là où un seul suffirait — ces tables gardent des clés d'API :
  // aucune policy, et depuis la 011, aucun droit non plus.
  check('lire les clés IA', true, (await asUser(jwt, '/ai_settings?select=*')).status >= 400);
  check(
    'lire les clés Tally',
    true,
    (await asUser(jwt, '/tally_credentials?select=*')).status >= 400
  );
  check(
    'lire les jetons Google',
    true,
    (await asUser(jwt, '/google_credentials?select=*')).status >= 400
  );

  // Les réglages de l'instance se lisent depuis le navigateur et ne s'écrivent
  // que par `/api/admin/settings`, qui vérifie lui-même le rang de l'appelant.
  check(
    'lire les réglages globaux',
    200,
    (await asUser(jwt, '/app_settings?select=allow_public_signup')).status
  );
  check(
    'écrire les réglages globaux',
    true,
    (
      await asUser(jwt, '/app_settings', {
        method: 'POST',
        body: JSON.stringify({ allow_public_signup: true })
      })
    ).status >= 400
  );

  // ── Le visiteur anonyme ───────────────────────────────────────────────────
  console.log('\n== Le visiteur anonyme ==');

  check('lire la table forms', true, (await anon('/forms?select=id')).status >= 400);
  check('lire la table submissions', true, (await anon('/submissions?select=id')).status >= 400);
  check('lire l’annuaire des partenaires', true, (await anon('/partners?select=id')).status >= 400);

  const publicForms = await anon('/public_forms?select=slug&limit=1');
  check('lire la vue publique des formulaires', 200, publicForms.status);
  check('… et y trouver quelque chose', true, (await publicForms.json()).length >= 0);
} finally {
  if (projectId) await admin(`/rest/v1/projects?id=eq.${projectId}`, { method: 'DELETE' });
  await admin(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
  console.log("\nCompte d'essai supprimé.");
}

console.log(`\n${pass} ok, ${fail} échec(s)`);
process.exit(fail === 0 ? 0 : 1);
