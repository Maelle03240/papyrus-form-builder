'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Info, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/Toast';
import { updateForm } from '@/lib/store';
import { cn } from '@/lib/utils';
import type {
  Field,
  Form,
  FormSettings,
  NotificationSettings,
  RespondentNotificationSettings,
  SelfNotificationSettings
} from '@/types';

/**
 * Onglet « Paramètres » d'un formulaire.
 *
 * Tous les réglages sont édités localement et enregistrés d'un bloc : basculer
 * six interrupteurs ne doit pas produire six écritures, et l'auteur doit pouvoir
 * changer d'avis avant de valider. La barre d'enregistrement n'apparaît que
 * lorsque quelque chose a effectivement changé.
 *
 * Certains réglages ne vivent pas dans `settings` mais dans des colonnes
 * dédiées, antérieures à cet onglet : mot de passe, date de clôture, statut,
 * reprise de saisie. Ils sont présentés ici avec les autres — l'utilisateur n'a
 * pas à connaître la forme de la base — et répartis au moment de l'écriture.
 */

interface DraftState {
  settings: FormSettings;
  notifications: NotificationSettings;
  defaultLanguage: string;
  accessPassword: string;
  passwordProtected: boolean;
  closed: boolean;
  closesAt: string | null;
  saveAndResume: boolean;
}

const DEFAULT_SELF: SelfNotificationSettings = {
  enabled: false,
  to: [],
  subject: '',
  body: ''
};

const DEFAULT_RESPONDENT: RespondentNotificationSettings = {
  enabled: false,
  from_name: '',
  reply_to: '',
  to_field_id: '',
  subject: '',
  body: '',
  attach_pdf: false
};

const LANGUAGES = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' }
];

/**
 * Sérialisation à clés triées, utilisée pour détecter les modifications.
 *
 * `JSON.stringify` ne suffit pas : `settings` et `notification_settings` sont
 * des colonnes `jsonb`, et PostgreSQL y réordonne les clés. Comparer la version
 * relue à celle qu'on vient d'envoyer produirait donc deux chaînes différentes
 * pour des données identiques, et la barre « modifications non enregistrées »
 * réapparaîtrait aussitôt après chaque enregistrement.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    // Une clé absente et une clé à `undefined` doivent se valoir : JSON.stringify
    // omet la seconde, on fait de même.
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

/** Convertit un ISO 8601 en valeur acceptée par `<input type="datetime-local">`. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function buildDraft(form: Form): DraftState {
  const notifications = form.notification_settings ?? {};
  return {
    settings: { ...(form.settings ?? {}) },
    notifications: {
      self: { ...DEFAULT_SELF, ...(notifications.self ?? {}) },
      respondent: { ...DEFAULT_RESPONDENT, ...(notifications.respondent ?? {}) }
    },
    defaultLanguage: form.default_language || 'fr',
    accessPassword: form.access_password ?? '',
    passwordProtected: form.access_type === 'password',
    closed: form.status === 'closed',
    closesAt: form.closes_at ?? null,
    saveAndResume: form.save_and_resume !== false
  };
}

export function FormSettingsTab({ form }: { form: Form }) {
  const [draft, setDraft] = useState<DraftState>(() => buildDraft(form));
  const [saving, setSaving] = useState(false);
  const serverState = useRef<DraftState>(buildDraft(form));
  const baseline = useRef(stableStringify(serverState.current));

  // Le formulaire peut être rechargé sous nos pieds (clonage, publication depuis
  // un autre onglet) : on repart de l'état serveur, sauf si une modification est
  // en cours d'édition — l'écraser ferait perdre la saisie.
  useEffect(() => {
    const fresh = buildDraft(form);
    serverState.current = fresh;
    setDraft((current) => (stableStringify(current) === baseline.current ? fresh : current));
    baseline.current = stableStringify(fresh);
  }, [form]);

  const dirty = stableStringify(draft) !== baseline.current;

  const emailFields = useMemo(
    () => (form.fields ?? []).filter((field: Field) => field.type === 'email'),
    [form.fields]
  );

  const identifiableFields = useMemo(
    () =>
      (form.fields ?? []).filter(
        (field: Field) =>
          !['statement', 'image', 'video', 'file'].includes(field.type)
      ),
    [form.fields]
  );

  function patch(update: Partial<DraftState>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function patchSettings(update: Partial<FormSettings>) {
    setDraft((current) => ({ ...current, settings: { ...current.settings, ...update } }));
  }

  function patchSelf(update: Partial<SelfNotificationSettings>) {
    setDraft((current) => ({
      ...current,
      notifications: {
        ...current.notifications,
        self: { ...DEFAULT_SELF, ...current.notifications.self, ...update }
      }
    }));
  }

  function patchRespondent(update: Partial<RespondentNotificationSettings>) {
    setDraft((current) => ({
      ...current,
      notifications: {
        ...current.notifications,
        respondent: { ...DEFAULT_RESPONDENT, ...current.notifications.respondent, ...update }
      }
    }));
  }

  async function save() {
    // Une redirection qui n'est pas une URL valide serait découverte par le
    // premier répondant, après l'envoi de sa réponse : on refuse ici.
    if (draft.settings.redirect_on_completion) {
      const url = draft.settings.redirect_url?.trim();
      if (!url || !/^https?:\/\//i.test(url)) {
        toast.error("L'URL de redirection doit commencer par http:// ou https://.");
        return;
      }
    }

    if (draft.passwordProtected && !draft.accessPassword.trim()) {
      toast.error('Choisissez un mot de passe, ou désactivez la protection.');
      return;
    }

    setSaving(true);
    try {
      await updateForm(form.id, {
        settings: draft.settings,
        notification_settings: draft.notifications,
        default_language: draft.defaultLanguage,
        access_type: draft.passwordProtected ? 'password' : 'public',
        access_password: draft.passwordProtected ? draft.accessPassword.trim() : null,
        // Refermer puis rouvrir un formulaire ne doit pas le renvoyer en
        // brouillon : un formulaire rouvert redevient publié.
        status: draft.closed ? 'closed' : 'published',
        closes_at: draft.closesAt,
        save_and_resume: draft.saveAndResume
      });

      baseline.current = stableStringify(draft);
      serverState.current = draft;
      toast.success('Paramètres enregistrés.');
    } catch (error) {
      console.error('Failed to save form settings:', error);
      toast.error("Les paramètres n'ont pas pu être enregistrés.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative space-y-10 pb-24">
      {/* ================= Général ================= */}
      <Section title="Général">
        <SettingRow
          label="Langue"
          description="Langue des libellés que Papyrus ajoute lui-même : boutons, messages d'erreur, dates."
          control={
            <select
              value={draft.defaultLanguage}
              onChange={(event) => patch({ defaultLanguage: event.target.value })}
              className="h-9 w-44 rounded-md border border-border-strong bg-bg-base px-2 text-sm text-text-primary focus:border-accent-cta focus:outline-hidden"
            >
              {LANGUAGES.map((language) => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </select>
          }
        />

        <SettingRow
          label="Redirection à la fin"
          description="Envoie le répondant vers une adresse de votre choix au lieu d'afficher la page de remerciement."
          control={
            <Switch
              checked={draft.settings.redirect_on_completion === true}
              onChange={(value) => patchSettings({ redirect_on_completion: value })}
            />
          }
        >
          {draft.settings.redirect_on_completion && (
            <TextField
              value={draft.settings.redirect_url ?? ''}
              onChange={(value) => patchSettings({ redirect_url: value })}
              placeholder="https://mooove.group/merci"
              hint="Le formulaire intégré ouvre cette page dans un nouvel onglet, pour ne pas détourner le site hôte."
            />
          )}
        </SettingRow>

        <SettingRow
          label="Barre de progression"
          description="Montre au répondant la part du formulaire déjà remplie. Encourage à aller jusqu'au bout."
          control={
            <Switch
              checked={draft.settings.progress_bar === true}
              onChange={(value) => patchSettings({ progress_bar: value })}
            />
          }
        />

        <SettingRow
          label="Réponses partielles"
          description="Conserve ce qui a été saisi même si le formulaire n'est pas envoyé. Les ébauches n'entrent ni dans les statistiques, ni dans les intégrations, ni dans les notifications."
          control={
            <Switch
              checked={draft.settings.partial_submissions === true}
              onChange={(value) => patchSettings({ partial_submissions: value })}
            />
          }
        />

        <SettingRow
          label="Durée de conservation"
          description="Supprime définitivement les réponses passé un certain délai."
          control={
            <Switch
              checked={draft.settings.data_retention_enabled === true}
              onChange={(value) => patchSettings({ data_retention_enabled: value })}
            />
          }
        >
          {draft.settings.data_retention_enabled && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={draft.settings.data_retention_days ?? 90}
                  onChange={(event) =>
                    patchSettings({
                      data_retention_days: Math.max(1, Number(event.target.value) || 1)
                    })
                  }
                  className="h-9 w-24 rounded-md border border-border-strong bg-bg-base px-3 text-sm text-text-primary focus:border-accent-cta focus:outline-hidden"
                />
                <span className="text-sm text-text-secondary">jours</span>
              </div>
              <Note tone="warning">
                La suppression est définitive et s&apos;applique aussi aux réponses déjà
                collectées. Elle est déclenchée à chaque nouvelle réponse et à
                l&apos;enregistrement de cet écran : un formulaire qui ne reçoit plus rien ne se
                purge plus.
              </Note>
            </div>
          )}
        </SettingRow>
      </Section>

      {/* ================= Notifications ================= */}
      <Section title="Notifications par email">
        <SettingRow
          label="Me prévenir à chaque réponse"
          description="Un email vous est envoyé dès qu'une réponse est enregistrée."
          control={
            <Switch
              checked={draft.notifications.self?.enabled === true}
              onChange={(value) => patchSelf({ enabled: value })}
            />
          }
        >
          {draft.notifications.self?.enabled && (
            <div className="space-y-3">
              <TextField
                label="Destinataires"
                value={(draft.notifications.self.to ?? []).join(', ')}
                onChange={(value) =>
                  patchSelf({
                    to: value
                      .split(',')
                      .map((address) => address.trim())
                      .filter(Boolean)
                  })
                }
                placeholder="vous@mooove.live, equipe@mooove.live"
                hint="Séparez les adresses par une virgule. Laissé vide, l'email part au créateur du formulaire."
              />
              <TextField
                label="Objet"
                value={draft.notifications.self.subject}
                onChange={(value) => patchSelf({ subject: value })}
                placeholder={`Nouvelle réponse — ${form.title}`}
              />
              <TemplateEditor
                label="Message"
                value={draft.notifications.self.body}
                onChange={(value) => patchSelf({ body: value })}
                fields={identifiableFields}
                placeholder={'Une nouvelle réponse vient d’être enregistrée.\n\n{{all_answers}}'}
              />
            </div>
          )}
        </SettingRow>

        <SettingRow
          label="Accusé de réception au répondant"
          description="Confirme la bonne réception à la personne qui vient de répondre."
          control={
            <Switch
              checked={draft.notifications.respondent?.enabled === true}
              onChange={(value) => patchRespondent({ enabled: value })}
            />
          }
        >
          {draft.notifications.respondent?.enabled && (
            <div className="space-y-3">
              {emailFields.length === 0 ? (
                <Note tone="warning">
                  Ce formulaire n&apos;a aucune question de type « email ». Sans adresse à qui
                  écrire, aucun accusé de réception ne pourra partir.
                </Note>
              ) : (
                <label className="block">
                  <span className="mb-1.5 block text-sm text-text-secondary">
                    Adresse du destinataire
                  </span>
                  <select
                    value={draft.notifications.respondent.to_field_id}
                    onChange={(event) => patchRespondent({ to_field_id: event.target.value })}
                    className="h-9 w-full max-w-md rounded-md border border-border-strong bg-bg-base px-2 text-sm text-text-primary focus:border-accent-cta focus:outline-hidden"
                  >
                    <option value="">Première question de type email</option>
                    {emailFields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.label?.fr || 'Question sans titre'}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Nom de l'expéditeur"
                  value={draft.notifications.respondent.from_name}
                  onChange={(value) => patchRespondent({ from_name: value })}
                  placeholder="Mooove Team"
                />
                <TextField
                  label="Répondre à"
                  value={draft.notifications.respondent.reply_to}
                  onChange={(value) => patchRespondent({ reply_to: value })}
                  placeholder="contact@mooove.live"
                />
              </div>

              <TextField
                label="Objet"
                value={draft.notifications.respondent.subject}
                onChange={(value) => patchRespondent({ subject: value })}
                placeholder={form.title}
              />

              <TemplateEditor
                label="Message"
                value={draft.notifications.respondent.body}
                onChange={(value) => patchRespondent({ body: value })}
                fields={identifiableFields}
                placeholder={'Bonjour,\n\nMerci pour votre réponse à {{form.title}}.'}
              />

              <Switch
                checked={draft.notifications.respondent.attach_pdf}
                onChange={(value) => patchRespondent({ attach_pdf: value })}
                label="Joindre un PDF des réponses"
                description="Un récapitulatif question / réponse, généré au moment de l'envoi."
              />

              <Note tone="info">
                L&apos;envoi passe par Resend. Sans clé <code className="font-mono">RESEND_API_KEY</code>{' '}
                configurée sur l&apos;instance, les notifications sont enregistrées mais aucun email
                ne part.
              </Note>
            </div>
          )}
        </SettingRow>
      </Section>

      {/* ================= Accès ================= */}
      <Section title="Accès">
        <SettingRow
          label="Protéger par un mot de passe"
          description="Le formulaire n'est accessible qu'avec ce mot de passe."
          control={
            <Switch
              checked={draft.passwordProtected}
              onChange={(value) => patch({ passwordProtected: value })}
            />
          }
        >
          {draft.passwordProtected && (
            <TextField
              type="password"
              value={draft.accessPassword}
              onChange={(value) => patch({ accessPassword: value })}
              placeholder="Mot de passe"
              hint="À communiquer aux répondants par un autre canal que le lien lui-même."
            />
          )}
        </SettingRow>

        <SettingRow
          label="Fermer le formulaire"
          description="Personne ne peut plus répondre. Le lien reste valide et affiche votre message de clôture."
          control={
            <Switch checked={draft.closed} onChange={(value) => patch({ closed: value })} />
          }
        />

        <SettingRow
          label="Fermer à une date donnée"
          description="Le formulaire cesse d'accepter des réponses à l'heure indiquée."
          control={
            <Switch
              checked={draft.closesAt !== null}
              onChange={(value) =>
                patch({
                  closesAt: value
                    ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
                    : null
                })
              }
            />
          }
        >
          {draft.closesAt !== null && (
            <input
              type="datetime-local"
              value={toLocalInput(draft.closesAt)}
              onChange={(event) =>
                patch({
                  closesAt: event.target.value
                    ? new Date(event.target.value).toISOString()
                    : null
                })
              }
              className="h-9 rounded-md border border-border-strong bg-bg-base px-3 text-sm text-text-primary focus:border-accent-cta focus:outline-hidden"
            />
          )}
        </SettingRow>

        <SettingRow
          label="Limiter le nombre de réponses"
          description="Le formulaire se ferme de lui-même une fois le quota atteint."
          control={
            <Switch
              checked={draft.settings.max_submissions_enabled === true}
              onChange={(value) => patchSettings({ max_submissions_enabled: value })}
            />
          }
        >
          {draft.settings.max_submissions_enabled && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={draft.settings.max_submissions ?? 100}
                onChange={(event) =>
                  patchSettings({ max_submissions: Math.max(1, Number(event.target.value) || 1) })
                }
                className="h-9 w-28 rounded-md border border-border-strong bg-bg-base px-3 text-sm text-text-primary focus:border-accent-cta focus:outline-hidden"
              />
              <span className="text-sm text-text-secondary">réponses au maximum</span>
            </div>
          )}
        </SettingRow>

        <SettingRow
          label="Message de clôture"
          description="Ce que voit un visiteur qui arrive sur un formulaire fermé, quelle qu'en soit la raison."
          control={
            <Switch
              checked={draft.settings.closed_message_enabled === true}
              onChange={(value) => patchSettings({ closed_message_enabled: value })}
            />
          }
        >
          {draft.settings.closed_message_enabled && (
            <textarea
              value={draft.settings.closed_message ?? ''}
              onChange={(event) => patchSettings({ closed_message: event.target.value })}
              rows={3}
              placeholder="Les inscriptions sont closes. Merci de votre intérêt !"
              className="w-full max-w-xl rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-accent-cta focus:outline-hidden"
            />
          )}
        </SettingRow>

        <SettingRow
          label="Empêcher les réponses en double"
          description="Une même valeur ne peut être soumise qu'une fois — utile pour un email, un matricule ou un numéro de téléphone."
          control={
            <Switch
              checked={draft.settings.prevent_duplicates === true}
              onChange={(value) => patchSettings({ prevent_duplicates: value })}
            />
          }
        >
          {draft.settings.prevent_duplicates && (
            <label className="block">
              <span className="mb-1.5 block text-sm text-text-secondary">
                Question servant d&apos;identifiant
              </span>
              <select
                value={draft.settings.duplicate_field_id ?? ''}
                onChange={(event) => patchSettings({ duplicate_field_id: event.target.value })}
                className="h-9 w-full max-w-md rounded-md border border-border-strong bg-bg-base px-2 text-sm text-text-primary focus:border-accent-cta focus:outline-hidden"
              >
                <option value="">— Choisir une question —</option>
                {identifiableFields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.label?.fr || 'Question sans titre'}
                  </option>
                ))}
              </select>
              {draft.settings.prevent_duplicates && !draft.settings.duplicate_field_id && (
                <span className="mt-1.5 block text-xs text-warning">
                  Sans question choisie, aucun doublon ne sera détecté.
                </span>
              )}
            </label>
          )}
        </SettingRow>
      </Section>

      {/* ================= Comportement ================= */}
      <Section title="Comportement">
        <SettingRow
          label="Passer automatiquement à la page suivante"
          description="Ne s'applique qu'aux pages ne contenant qu'une seule question à réponse unique (choix unique, liste, notation)."
          control={
            <Switch
              checked={draft.settings.auto_jump === true}
              onChange={(value) => patchSettings({ auto_jump: value })}
            />
          }
        >
          {draft.settings.auto_jump && form.display_mode !== 'sections' && (
            <Note tone="info">
              Ce formulaire est en affichage «{' '}
              {form.display_mode === 'typeform' ? 'une question à la fois' : 'défilement'} ». Le
              passage automatique ne concerne que l&apos;affichage par sections.
            </Note>
          )}
        </SettingRow>

        <SettingRow
          label="Reprendre plus tard"
          description="Les réponses en cours sont gardées dans le navigateur du répondant, qui retrouve sa saisie s'il revient."
          control={
            <Switch
              checked={draft.saveAndResume}
              onChange={(value) => patch({ saveAndResume: value })}
            />
          }
        />
      </Section>

      {/* ================= Barre d'enregistrement ================= */}
      <div
        className={cn(
          'sticky bottom-0 -mx-1 flex items-center justify-between gap-4 rounded-t-xl border-t border-border bg-bg-surface/95 px-5 py-3 backdrop-blur transition-all',
          dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
        )}
      >
        <p className="text-sm text-text-secondary">Modifications non enregistrées</p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setDraft(serverState.current)} disabled={saving}>
            Annuler
          </Button>
          <Button
            variant="cta"
            onClick={save}
            disabled={saving}
            iconLeft={
              saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />
            }
          >
            Enregistrer
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Blocs de présentation
// ============================================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-xl">{title}</h2>
      <div className="mt-3 divide-y divide-border rounded-2xl border border-border bg-bg-surface">
        {children}
      </div>
    </section>
  );
}

function SettingRow({
  label,
  description,
  control,
  children
}: {
  label: string;
  description?: string;
  control: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-text-primary">{label}</h3>
          {description && (
            <p className="mt-0.5 max-w-2xl text-sm leading-snug text-text-secondary">
              {description}
            </p>
          )}
        </div>
        <div className="shrink-0">{control}</div>
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = 'text'
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  type?: 'text' | 'password';
}) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm text-text-secondary">{label}</span>}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full max-w-xl rounded-md border border-border-strong bg-bg-base px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-cta focus:outline-hidden"
      />
      {hint && <span className="mt-1.5 block max-w-xl text-xs text-text-tertiary">{hint}</span>}
    </label>
  );
}

function Note({
  children,
  tone
}: {
  children: React.ReactNode;
  tone: 'info' | 'warning';
}) {
  const Icon = tone === 'warning' ? AlertTriangle : Info;
  return (
    <p
      className={cn(
        'flex max-w-2xl items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-snug',
        tone === 'warning'
          ? 'border-warning/40 bg-warning/5 text-warning'
          : 'border-border bg-bg-base text-text-tertiary'
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Zone de texte avec insertion de variables.
 *
 * Les variables sont insérées à la position du curseur plutôt qu'en fin de
 * texte : sans cela, écrire « Bonjour X, » obligerait à couper-coller la
 * variable à chaque fois.
 */
function TemplateEditor({
  label,
  value,
  onChange,
  fields,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  fields: Field[];
  placeholder?: string;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);

  function insert(token: string) {
    const element = textarea.current;
    const snippet = `{{${token}}}`;

    if (!element) {
      onChange(`${value}${snippet}`);
      return;
    }

    const start = element.selectionStart ?? value.length;
    const end = element.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`;
    onChange(next);

    // Le curseur doit se replacer après l'insertion, une fois React repassé.
    window.requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm text-text-secondary">{label}</span>
      <textarea
        ref={textarea}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={6}
        placeholder={placeholder}
        className="w-full max-w-xl rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm leading-relaxed text-text-primary placeholder:text-text-tertiary focus:border-accent-cta focus:outline-hidden"
      />
      <div className="mt-2 flex max-w-xl flex-wrap items-center gap-1.5">
        <span className="text-xs text-text-tertiary">Insérer :</span>
        <TokenButton onClick={() => insert('form.title')}>titre du formulaire</TokenButton>
        <TokenButton onClick={() => insert('submission.date')}>date d’envoi</TokenButton>
        <TokenButton onClick={() => insert('all_answers')}>toutes les réponses</TokenButton>
        {fields.slice(0, 12).map((field) => (
          <TokenButton
            key={field.id}
            onClick={() => insert(field.label?.fr || field.id)}
          >
            {field.label?.fr || 'Question sans titre'}
          </TokenButton>
        ))}
      </div>
    </div>
  );
}

function TokenButton({
  children,
  onClick
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="max-w-[180px] truncate rounded-full border border-border bg-bg-base px-2 py-0.5 text-[11px] text-text-secondary transition hover:border-accent-cta hover:text-text-primary"
    >
      {children}
    </button>
  );
}
