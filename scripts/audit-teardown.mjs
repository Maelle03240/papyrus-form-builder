// Supprime tout ce que la revue a créé : le projet d'audit, l'équipe, le
// compte d'essai. Rien ne doit survivre à une revue.
//
//   node scripts/audit-teardown.mjs .audit/session.json [.audit/form.json]
import fs from 'node:fs';

const session = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const form = process.argv[3] && fs.existsSync(process.argv[3])
  ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
  : null;

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
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

const admin = (path, init = {}) =>
  fetch(`${SB}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'papyrus',
      'Accept-Profile': 'papyrus',
      ...init.headers
    }
  });

if (form?.projectId) {
  await admin(`/rest/v1/projects?id=eq.${form.projectId}`, { method: 'DELETE' });
  console.log(`projet ${form.projectId} supprimé`);
}

// Les formulaires créés par la revue du constructeur n'appartiennent à aucun
// projet : ils partent avec l'équipe.
await admin(`/rest/v1/forms?team_id=eq.${session.teamId}`, { method: 'DELETE' });
await admin(`/rest/v1/teams?id=eq.${session.teamId}`, { method: 'DELETE' });
console.log(`équipe ${session.teamId} supprimée`);

await admin(`/auth/v1/admin/users/${session.userId}`, { method: 'DELETE' });
console.log(`compte ${session.userId} supprimé`);
