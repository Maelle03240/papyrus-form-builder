// Construit le formulaire de la revue : les 27 types de champ, deux sections,
// une règle de logique, de la tarification. C'est le pire cas de rendu — et
// c'est en le traversant écran par écran qu'on a trouvé le séparateur promu en
// question, le champ caché devenu un écran vide, et le message destiné à
// l'auteur affiché au répondant.
//
//   node scripts/audit-form.mjs .audit/session.json .audit/form.json
import fs from 'node:fs';

const SESSION = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

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

const api = (p, init = {}) =>
  fetch(`${SB}/rest/v1${p}`, {
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

const SLUG = `audit-complet-${Date.now().toString(36)}`;

const [project] = await (
  await api('/projects', {
    method: 'POST',
    body: JSON.stringify({
      team_id: SESSION.teamId,
      name: 'Audit complet',
      modules: { pricing: true, partners: true, invoicing: true, email: true },
      pricing: { currency: 'MUR', currency_position: 'before', vat_enabled: true, vat_rate: 15 }
    })
  })
).json();

const [form] = await (
  await api('/forms', {
    method: 'POST',
    body: JSON.stringify({
      team_id: SESSION.teamId,
      project_id: project.id,
      title: 'Audit complet',
      slug: SLUG,
      description: 'Tous les types de champ, pour éprouver les trois modes.',
      display_mode: 'scroll',
      status: 'published',
      published_at: new Date().toISOString(),
      theme: { bg: '#EFF9FE', accent: '#2AC2DE', font: 'sans' },
      access_type: 'public',
      languages: ['fr'],
      default_language: 'fr',
      pricing_config: { enabled: true },
      scoring_enabled: false
    })
  })
).json();

const sections = await (
  await api('/sections', {
    method: 'POST',
    body: JSON.stringify([
      { form_id: form.id, title: { fr: 'Identité' }, section_order: 0 },
      { form_id: form.id, title: { fr: 'Le reste' }, section_order: 1 }
    ])
  })
).json();

const [s1, s2] = sections.sort((a, b) => a.section_order - b.section_order);

const label = (fr) => ({ fr });
const opts = (...names) =>
  names.map((n, i) => ({ id: `o-${i}`, label: { fr: n }, price: i === 0 ? 1000 : 0 }));

// Le premier champ s'appelle « Nom complet » : c'est celui que le test cherche
// dans les trois modes.
const FIELDS = [
  { type: 'short_text', label: label('Nom complet'), section: s1, required: true },
  { type: 'email', label: label('Adresse e-mail'), section: s1, required: true },
  { type: 'long_text', label: label('Commentaire'), section: s1 },
  { type: 'phone', label: label('Téléphone'), section: s1 },
  { type: 'url', label: label('Site web'), section: s1 },
  { type: 'address', label: label('Adresse postale'), section: s1 },
  { type: 'single_choice', label: label('Formule'), section: s1, options: opts('Journée', 'Soirée') },
  {
    type: 'multiple_choice',
    label: label('Ateliers'),
    section: s1,
    options: opts('Cuisine', 'Danse', 'Photo')
  },
  { type: 'dropdown', label: label('Pays de résidence'), section: s1, options: opts('Maurice', 'France') },
  { type: 'yesno', label: label('Déjà venu'), section: s1 },
  { type: 'country', label: label('Nationalité'), section: s1 },
  { type: 'rating', label: label('Satisfaction'), section: s2, validation: { max: 5 } },
  { type: 'nps', label: label('Recommandation'), section: s2 },
  {
    type: 'matrix',
    label: label('Évaluez chaque volet'),
    section: s2,
    options: opts('Bien', 'Moyen', 'Mauvais'),
    rows: [
      { id: 'r-1', label: { fr: 'Accueil' } },
      { id: 'r-2', label: { fr: 'Repas' } }
    ]
  },
  { type: 'number', label: label('Nombre de places'), section: s2 },
  { type: 'currency', label: label('Don libre'), section: s2, validation: { currency_code: 'MUR' } },
  { type: 'date', label: label('Date d’arrivée'), section: s2 },
  { type: 'file', label: label('Pièce jointe'), section: s2, validation: { respondent_mode_enabled: true } },
  { type: 'signature', label: label('Signature'), section: s2 },
  {
    type: 'repeater',
    label: label('Accompagnants'),
    section: s2,
    validation: {
      subfields: [
        { id: 'sf-1', type: 'short_text', label: { fr: 'Prénom' } },
        { id: 'sf-2', type: 'number', label: { fr: 'Âge' } }
      ]
    }
  },
  {
    type: 'calculated',
    label: label('Total des âges'),
    section: s2,
    calc: { mode: 'sum', sources: [] }
  },
  { type: 'hidden', label: label('Source'), section: s2, validation: { hidden_param: 'utm' } },
  { type: 'statement', label: label('Bon à savoir'), description: label('Le parking est gratuit.'), section: s2 },
  { type: 'image', label: label('Affiche'), section: s2 },
  { type: 'video', label: label('Teaser'), section: s2 },
  { type: 'link', label: label('Le règlement'), section: s2, validation: { link_url: 'https://exemple.mu' } },
  { type: 'divider', label: label(''), section: s2 }
];

const rows = FIELDS.map((f, index) => ({
  form_id: form.id,
  section_id: f.section.id,
  type: f.type,
  label: f.label,
  description: f.description ?? { fr: '' },
  field_order: index,
  required: f.required ?? false,
  options: f.options ?? [],
  rows: f.rows ?? [],
  validation: f.validation ?? {},
  calc: f.calc ?? null
}));

const inserted = await (await api('/fields', { method: 'POST', body: JSON.stringify(rows) })).json();

if (!Array.isArray(inserted)) {
  console.error(JSON.stringify(inserted).slice(0, 600));
  process.exit(1);
}

const byLabel = Object.fromEntries(inserted.map((f) => [f.label?.fr, f.id]));

// Une règle : « Déjà venu » = non masque le commentaire.
await api('/logic_rules', {
  method: 'POST',
  body: JSON.stringify({
    form_id: form.id,
    name: 'Masquer le commentaire',
    action: 'hide',
    target_field_id: byLabel['Commentaire'],
    conditions: {
      operator: 'AND',
      conditions: [
        { source_field_id: byLabel['Déjà venu'], operator: 'equals', value: 'no' }
      ]
    },
    rule_order: 0
  })
});

fs.writeFileSync(
  process.argv[3] ?? 'audit-form.json',
  JSON.stringify({ projectId: project.id, formId: form.id, slug: SLUG }, null, 2)
);

console.log(`projet ${project.id}`);
console.log(`formulaire ${form.id} — ${inserted.length} champs`);
console.log(`slug ${SLUG}`);
