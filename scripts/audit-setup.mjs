// Prépare la revue complète : un compte d'essai, une équipe à part, une session.
//
// Écrit le cookie de session dans le fichier passé en argument, que
// `tests/e2e/audit.spec.ts` lit via E2E_SESSION_FILE.
//
//   node scripts/audit-setup.mjs .audit/session.json
//
// L'équipe est neuve et vide : la revue ne touche à aucune donnée existante.
// `scripts/audit-teardown.mjs` supprime tout ensuite.
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? 'audit-session.json';

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

const EMAIL = `audit+${Date.now()}@papyrus-test.local`;
const PASSWORD = `Audit!${Math.random().toString(36).slice(2)}`;

const admin = (p, init = {}) =>
  fetch(`${SB}${p}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'papyrus',
      'Accept-Profile': 'papyrus',
      Prefer: 'return=representation',
      ...init.headers
    }
  });

const createdUser = await admin('/auth/v1/admin/users', {
  method: 'POST',
  body: JSON.stringify({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Auditrice Papyrus' }
  })
});
const user = await createdUser.json();
if (!user.id) throw new Error(JSON.stringify(user).slice(0, 400));

// Une équipe à part : l'audit ne doit toucher à rien d'existant.
const teamResponse = await admin('/rest/v1/teams', {
  method: 'POST',
  body: JSON.stringify({ name: 'Audit Papyrus', is_deletable: true })
});
const [team] = await teamResponse.json();

await admin('/rest/v1/team_members', {
  method: 'POST',
  body: JSON.stringify({ team_id: team.id, user_id: user.id, role: 'admin' })
});

const signIn = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD })
});
const session = await signIn.json();
if (!session.access_token) throw new Error(JSON.stringify(session).slice(0, 400));

const ref = new URL(SB).hostname.split('.')[0];
const cookieValue = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;

fs.writeFileSync(
  path.resolve(OUT),
  JSON.stringify(
    {
      email: EMAIL,
      password: PASSWORD,
      userId: user.id,
      teamId: team.id,
      cookieName: `sb-${ref}-auth-token`,
      cookieValue,
      accessToken: session.access_token,
      supabaseUrl: SB,
      anonKey: ANON
    },
    null,
    2
  )
);

console.log(`compte ${user.id}`);
console.log(`équipe ${team.id}`);
console.log(`session écrite dans ${OUT}`);
