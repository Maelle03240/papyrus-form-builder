'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Loader2,
  Mail,
  Plus,
  Save,
  Trash2,
  TriangleAlert
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/Toast';
import { ConditionsEditor } from '@/components/builder/ConditionsEditor';
import { RichTextEditor } from '@/components/builder/RichTextEditor';
import { updateForm } from '@/lib/store';
import { stableStringify } from '@/lib/stable-stringify';
import {
  chooseEmailMessage,
  emailTokens,
  fallbackMessage,
  pickText,
  renderTemplate,
  sampleResponses,
  type EmailToken
} from '@/lib/email/tokens';
import { cn } from '@/lib/utils';
import type {
  ConfirmationConfig,
  EmailConfig,
  EmailMessage,
  EmailRule,
  Field,
  Form,
  MultilingualText,
  Project
} from '@/types';

/**
 * Onglet « E-mails » d'un formulaire.
 *
 * Il règle ce qui se passe une fois le formulaire envoyé : le message reçu par
 * le répondant, et l'écran qu'il a sous les yeux. Les deux sont ici parce qu'ils
 * se rédigent ensemble — un écran qui annonce « un e-mail vient de partir »
 * alors qu'aucun n'est configuré est le genre d'incohérence qu'on ne voit qu'en
 * séparant les deux réglages.
 *
 * Les règles conditionnelles citent des questions du formulaire : c'est la
 * raison pour laquelle cette configuration vit sur le formulaire et non sur le
 * projet. Elles réutilisent `ConditionsEditor`, le même éditeur que les verrous
 * de visibilité, donc la même grammaire — un auteur qui sait écrire « n'afficher
 * que si… » sait écrire « n'envoyer que si… ».
 */

const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'Français',
  en: 'English',
  es: 'Español'
};

const INPUT =
  'h-9 w-full rounded-md border border-border-strong bg-bg-base px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden';

interface DraftState {
  email: EmailConfig;
  confirmation: ConfirmationConfig;
}

function buildDraft(form: Form): DraftState {
  const email = (form.email_config ?? {}) as Partial<EmailConfig>;
  return {
    email: {
      enabled: email.enabled === true,
      to_field_id: email.to_field_id ?? '',
      from_name: email.from_name ?? '',
      reply_to: email.reply_to ?? '',
      cc: email.cc ?? '',
      bcc: email.bcc ?? '',
      attach_pdf: email.attach_pdf !== false,
      default_message: {
        subject: email.default_message?.subject ?? { fr: '' },
        body: email.default_message?.body ?? { fr: '' }
      },
      rules: (email.rules ?? []).map((rule) => ({ ...rule }))
    },
    confirmation: { ...((form.confirmation_config ?? {}) as ConfirmationConfig) }
  };
}

interface Props {
  form: Form;
  project: Project | null;
  /** Lien vers l'onglet des questions — pour aller y ajouter un champ e-mail. */
  buildHref: string;
  /** Lien vers les paramètres du projet — pour y activer la numérotation. */
  projectSettingsHref: string;
  onSaved: (patch: Partial<Form>) => void;
}

export function FormEmailTab({
  form,
  project,
  buildHref,
  projectSettingsHref,
  onSaved
}: Props) {
  const [draft, setDraft] = useState<DraftState>(() => buildDraft(form));
  const [saving, setSaving] = useState(false);
  const serverState = useRef<DraftState>(buildDraft(form));
  const baseline = useRef(stableStringify(serverState.current));

  useEffect(() => {
    const fresh = buildDraft(form);
    serverState.current = fresh;
    setDraft((current) => (stableStringify(current) === baseline.current ? fresh : current));
    baseline.current = stableStringify(fresh);
  }, [form]);

  const dirty = stableStringify(draft) !== baseline.current;

  const languages = form.languages?.length ? form.languages : ['fr'];
  const [language, setLanguage] = useState(form.default_language || languages[0]);

  const tokens = useMemo(() => emailTokens(form), [form]);

  // Les identifiants de champ sont des UUID : sans cette table, l'auteur écrit
  // « Bonjour {{ea92b44b-d0e7-…}}, » et ne peut plus dire quel jeton désigne
  // quoi. Le corps enregistré, lui, garde bien l'identifiant — renommer une
  // question ne doit pas casser en silence les e-mails qui la citent.
  const tokenLabels = useMemo(
    () => Object.fromEntries(tokens.map((token) => [token.token, token.label])),
    [tokens]
  );
  const emailFields = useMemo(
    () => (form.fields ?? []).filter((field: Field) => field.type === 'email'),
    [form.fields]
  );

  const invoicingOn = project?.modules.invoicing === true;
  const respondentNotificationOn = form.notification_settings?.respondent?.enabled === true;

  const patchEmail = useCallback((update: Partial<EmailConfig>) => {
    setDraft((current) => ({ ...current, email: { ...current.email, ...update } }));
  }, []);

  const patchConfirmation = useCallback((update: Partial<ConfirmationConfig>) => {
    setDraft((current) => ({
      ...current,
      confirmation: { ...current.confirmation, ...update }
    }));
  }, []);

  async function save() {
    setSaving(true);
    try {
      // Les règles sans condition sont écartées à l'enregistrement plutôt qu'au
      // moment de l'envoi : une règle vide correspond à tout, donc elle masque
      // toutes celles qui la suivent. La supprimer ici la fait disparaître de
      // l'écran, ce qui vaut mieux qu'un e-mail inexplicable en production.
      const rules = (draft.email.rules ?? []).filter((rule) => rule.when?.conditions?.length);
      const dropped = (draft.email.rules ?? []).length - rules.length;

      const patch: Partial<Form> = {
        email_config: { ...draft.email, rules },
        confirmation_config: draft.confirmation
      };
      await updateForm(form.id, patch);

      const saved: DraftState = { ...draft, email: { ...draft.email, rules } };
      baseline.current = stableStringify(saved);
      serverState.current = saved;
      setDraft(saved);
      onSaved(patch);

      toast.success(
        dropped > 0
          ? `Enregistré. ${dropped} règle sans condition a été retirée.`
          : 'E-mails enregistrés.'
      );
    } catch (error) {
      console.error('Failed to save email config:', error);
      toast.error("Les réglages n'ont pas pu être enregistrés.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-10 px-6 py-8 pb-24">
      <header>
        <h2 className="font-display text-lg font-bold text-text-primary">E-mails</h2>
        <p className="mt-1 text-sm leading-relaxed text-text-secondary">
          Ce que le répondant reçoit, et ce qu&apos;il voit à l&apos;écran, une fois le
          formulaire envoyé.
        </p>
      </header>

      {/* ================= Envoi ================= */}
      <section>
        <div className="flex items-start gap-3 rounded-xl border border-border bg-bg-surface p-4">
          <Switch
            checked={draft.email.enabled}
            onChange={(enabled) => patchEmail({ enabled })}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">
              Envoyer un e-mail de confirmation
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
              Part dès la réponse enregistrée. Un échec d&apos;envoi ne fait jamais perdre la
              réponse.
            </p>
          </div>
        </div>

        {draft.email.enabled && emailFields.length === 0 && (
          <Notice tone="warning">
            Aucune question ne demande d&apos;adresse e-mail : aucun message ne peut partir.
            Ajoutez un champ « E-mail » dans{' '}
            <Link href={buildHref} className="font-medium text-accent hover:underline">
              l&apos;onglet Questions
            </Link>
            .
          </Notice>
        )}

        {draft.email.enabled && respondentNotificationOn && (
          <Notice tone="info">
            L&apos;accusé de réception de l&apos;onglet Paramètres est désactivé tant que cet
            onglet est actif : sans cela, chaque répondant recevrait deux messages.
          </Notice>
        )}
      </section>

      {draft.email.enabled && (
        <>
          {/* ================= Destinataires ================= */}
          <Section
            title="Destinataires"
            hint="L'adresse d'expédition est celle de l'instance ; c'est le nom affiché qui change."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled label="Adresse du répondant" htmlFor="email-to-field">
                <select
                  id="email-to-field"
                  value={draft.email.to_field_id ?? ''}
                  onChange={(event) => patchEmail({ to_field_id: event.target.value })}
                  className={INPUT}
                >
                  <option value="">Premier champ e-mail rempli</option>
                  {emailFields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.label?.fr || 'Question sans libellé'}
                    </option>
                  ))}
                </select>
                <Hint>
                  Un champ masqué par une condition est ignoré : c&apos;est la branche
                  réellement suivie qui donne l&apos;adresse.
                </Hint>
              </Labelled>

              <Labelled label="Nom de l'expéditeur" htmlFor="email-from-name">
                <input
                  id="email-from-name"
                  value={draft.email.from_name ?? ''}
                  onChange={(event) => patchEmail({ from_name: event.target.value })}
                  placeholder={project?.name || 'Papyrus'}
                  maxLength={80}
                  className={INPUT}
                />
              </Labelled>

              <Labelled label="Répondre à" htmlFor="email-reply-to">
                <input
                  id="email-reply-to"
                  type="email"
                  value={draft.email.reply_to ?? ''}
                  onChange={(event) => patchEmail({ reply_to: event.target.value })}
                  placeholder="contact@mooove.group"
                  className={INPUT}
                />
              </Labelled>

              <Labelled label="Copie (Cc)" htmlFor="email-cc">
                <input
                  id="email-cc"
                  value={draft.email.cc ?? ''}
                  onChange={(event) => patchEmail({ cc: event.target.value })}
                  placeholder="compta@mooove.group"
                  className={INPUT}
                />
              </Labelled>

              <Labelled label="Copie cachée (Cci)" htmlFor="email-bcc">
                <input
                  id="email-bcc"
                  value={draft.email.bcc ?? ''}
                  onChange={(event) => patchEmail({ bcc: event.target.value })}
                  placeholder="archives@mooove.group"
                  className={INPUT}
                />
                <Hint>Plusieurs adresses se séparent par une virgule.</Hint>
              </Labelled>
            </div>
          </Section>

          {/* ================= Message par défaut ================= */}
          <Section
            title="Message par défaut"
            hint="Envoyé quand aucune règle conditionnelle ne correspond."
          >
            {languages.length > 1 && (
              <LanguageTabs
                languages={languages}
                active={language}
                onChange={setLanguage}
              />
            )}

            <MessageEditor
              message={draft.email.default_message}
              onChange={(message) => patchEmail({ default_message: message })}
              language={language}
              tokens={tokens}
              tokenLabels={tokenLabels}
              scope="default"
            />

            <div className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-bg-base p-3">
              <Switch
                checked={draft.email.attach_pdf !== false}
                onChange={(attach_pdf) => patchEmail({ attach_pdf })}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-primary">
                  Joindre le {invoicingOn ? 'bon de commande' : 'récapitulatif'} en PDF
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
                  Le document reprend les questions réellement affichées au répondant, ses
                  réponses et, s&apos;il y en a, les totaux.{' '}
                  <a
                    href={`/api/forms/${form.id}/pdf-preview`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-accent hover:underline"
                  >
                    Voir un aperçu
                  </a>
                  .
                </p>
              </div>
            </div>

            {!invoicingOn && (
              <Hint>
                Le document ne porte pas encore de numéro : la numérotation s&apos;active dans
                les{' '}
                <Link
                  href={projectSettingsHref}
                  className="font-medium text-accent hover:underline"
                >
                  paramètres du projet
                </Link>
                .
              </Hint>
            )}
          </Section>

          {/* ================= Règles ================= */}
          <RulesSection
            rules={draft.email.rules ?? []}
            onChange={(rules) => patchEmail({ rules })}
            fields={form.fields ?? []}
            language={language}
            tokens={tokens}
            tokenLabels={tokenLabels}
            attachDefault={draft.email.attach_pdf !== false}
          />

          {/* ================= Aperçu ================= */}
          <PreviewSection
            form={form}
            config={draft.email}
            language={language}
            projectName={project?.name}
            invoicePrefix={project?.invoicing.prefix}
          />
        </>
      )}

      {/* ================= Écran de remerciement ================= */}
      <ConfirmationSection
        confirmation={draft.confirmation}
        onChange={patchConfirmation}
        language={language}
        invoicingOn={invoicingOn}
      />

      <SaveBar
        dirty={dirty}
        saving={saving}
        onCancel={() => setDraft(serverState.current)}
        onSave={() => void save()}
      />
    </div>
  );
}

// ============================================================================
// Rédaction d'un message
// ============================================================================

function MessageEditor({
  message,
  onChange,
  language,
  tokens,
  tokenLabels,
  attachOverride,
  onAttachOverride,
  attachDefault,
  scope
}: {
  message: EmailMessage;
  onChange: (message: EmailMessage) => void;
  language: string;
  tokens: EmailToken[];
  tokenLabels: Record<string, string>;
  /** Présent uniquement sur une règle : elle peut surcharger la pièce jointe. */
  attachOverride?: boolean | undefined;
  onAttachOverride?: (value: boolean | undefined) => void;
  attachDefault?: boolean;
  /**
   * Préfixe des identifiants de champ.
   *
   * Le message par défaut et la règle ouverte sont affichés en même temps :
   * sans préfixe, leurs deux objets porteraient le même `id`, et cliquer sur
   * l'étiquette de l'un placerait le curseur dans l'autre.
   */
  scope: string;
}) {
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const insertInBody = useRef<((text: string) => void) | null>(null);
  const [target, setTarget] = useState<'subject' | 'body'>('body');

  const setLocalized = (key: 'subject' | 'body', value: string) => {
    const current = (message[key] ?? { fr: '' }) as MultilingualText;
    onChange({ ...message, [key]: { ...current, [language]: value } });
  };

  /**
   * Insère un jeton là où se trouve le curseur.
   *
   * Ajouter à la fin serait plus simple, mais un auteur qui écrit « Bonjour , »
   * puis insère le prénom attend qu'il atterrisse entre les deux — pas après le
   * point final.
   */
  const insert = (token: string) => {
    const text = `{{${token}}}`;
    if (target === 'subject') {
      const input = subjectRef.current;
      const current = pickText(message.subject, language);
      if (!input) {
        setLocalized('subject', `${current}${text}`);
        return;
      }
      const start = input.selectionStart ?? current.length;
      const end = input.selectionEnd ?? start;
      setLocalized('subject', `${current.slice(0, start)}${text}${current.slice(end)}`);
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(start + text.length, start + text.length);
      });
      return;
    }
    insertInBody.current?.(text);
  };

  return (
    <div className="space-y-4">
      <Labelled label="Objet" htmlFor={`${scope}-subject-${language}`}>
        <input
          id={`${scope}-subject-${language}`}
          ref={subjectRef}
          value={pickText(message.subject, language)}
          onFocus={() => setTarget('subject')}
          onChange={(event) => setLocalized('subject', event.target.value)}
          placeholder="Votre inscription est confirmée"
          maxLength={200}
          className={INPUT}
        />
      </Labelled>

      <div>
        <div className="mb-1.5 flex items-end justify-between gap-3">
          <span className="text-sm text-text-secondary">Message</span>
          <TokenPicker tokens={tokens} onPick={insert} />
        </div>
        <div onFocusCapture={() => setTarget('body')}>
          <RichTextEditor
            value={pickText(message.body, language)}
            onChange={(html) => setLocalized('body', html)}
            resetKey={language}
            tokenLabels={tokenLabels}
            placeholder="Bonjour, nous avons bien reçu votre inscription…"
            onReady={(fn) => {
              insertInBody.current = fn;
            }}
          />
        </div>
        <Hint>
          Un jeton inséré dans l&apos;objet ou le message est remplacé par la réponse
          correspondante. Laissé vide, le message de repli part quand même.
        </Hint>
      </div>

      {onAttachOverride && (
        <Labelled label="Pièce jointe" htmlFor={`${scope}-attach`}>
          <select
            id={`${scope}-attach`}
            value={attachOverride === undefined ? '' : String(attachOverride)}
            onChange={(event) =>
              onAttachOverride(
                event.target.value === '' ? undefined : event.target.value === 'true'
              )
            }
            className={INPUT}
          >
            <option value="">
              Comme le message par défaut ({attachDefault ? 'jointe' : 'sans'})
            </option>
            <option value="true">Joindre le PDF</option>
            <option value="false">Ne rien joindre</option>
          </select>
        </Labelled>
      )}
    </div>
  );
}

/**
 * Sélecteur de jetons.
 *
 * Une liste déroulante native plutôt qu'un menu dessiné : elle se parcourt au
 * clavier, se cherche en tapant les premières lettres, et ne peut pas se
 * retrouver coupée par le débordement d'un panneau.
 */
function TokenPicker({
  tokens,
  onPick
}: {
  tokens: EmailToken[];
  onPick: (token: string) => void;
}) {
  const groups = ['Informations', 'Réponses'] as const;

  return (
    <select
      value=""
      aria-label="Insérer une réponse"
      onChange={(event) => {
        if (!event.target.value) return;
        onPick(event.target.value);
        event.target.value = '';
      }}
      className="h-8 rounded-md border border-border-strong bg-bg-base px-2 text-xs text-text-secondary focus:border-accent focus:outline-hidden"
    >
      <option value="">Insérer…</option>
      {groups.map((group) => {
        const items = tokens.filter((token) => token.group === group);
        if (items.length === 0) return null;
        return (
          <optgroup key={group} label={group}>
            {items.map((token) => (
              <option key={token.token} value={token.token}>
                {token.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

// ============================================================================
// Règles conditionnelles
// ============================================================================

function RulesSection({
  rules,
  onChange,
  fields,
  language,
  tokens,
  tokenLabels,
  attachDefault
}: {
  rules: EmailRule[];
  onChange: (rules: EmailRule[]) => void;
  fields: Field[];
  language: string;
  tokens: EmailToken[];
  tokenLabels: Record<string, string>;
  attachDefault: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const patchRule = (id: string, update: Partial<EmailRule>) => {
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...update } : rule)));
  };

  const add = () => {
    const rule: EmailRule = {
      id: `rule-${Date.now().toString(36)}`,
      label: '',
      message: { subject: { fr: '' }, body: { fr: '' } }
    };
    onChange([...rules, rule]);
    setOpenId(rule.id);
  };

  const move = (index: number, direction: -1 | 1) => {
    const next = [...rules];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <Section
      title="Messages conditionnels"
      hint="Évalués de haut en bas. Le premier dont les conditions sont réunies remplace le message par défaut."
    >
      {rules.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong bg-bg-base px-4 py-6 text-center text-sm leading-relaxed text-text-secondary">
          Aucun message conditionnel. Le message par défaut part à chaque réponse.
        </p>
      ) : (
        <ul className="space-y-3">
          {rules.map((rule, index) => {
            const open = openId === rule.id;
            const incomplete = !rule.when?.conditions?.length;

            return (
              <li key={rule.id} className="rounded-xl border border-border bg-bg-surface">
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="font-mono text-xs text-text-tertiary">{index + 1}</span>
                  <input
                    value={rule.label}
                    onChange={(event) => patchRule(rule.id, { label: event.target.value })}
                    placeholder="Nom de la règle — « Tarif étudiant »"
                    aria-label={`Nom de la règle ${index + 1}`}
                    className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-medium text-text-primary placeholder:font-normal placeholder:text-text-tertiary focus:outline-hidden"
                  />
                  {incomplete && (
                    <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                      sans condition
                    </span>
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={`Monter la règle ${index + 1}`}
                      className="rounded-sm px-1.5 py-1 text-xs text-text-tertiary transition hover:bg-bg-elevated hover:text-text-primary disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === rules.length - 1}
                      aria-label={`Descendre la règle ${index + 1}`}
                      className="rounded-sm px-1.5 py-1 text-xs text-text-tertiary transition hover:bg-bg-elevated hover:text-text-primary disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange(rules.filter((r) => r.id !== rule.id))}
                      aria-label={`Supprimer la règle ${index + 1}`}
                      className="rounded-sm px-1.5 py-1 text-text-tertiary transition hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenId(open ? null : rule.id)}
                    >
                      {open ? 'Replier' : 'Modifier'}
                    </Button>
                  </div>
                </div>

                {open && (
                  <div className="space-y-5 border-t border-border px-4 py-4">
                    <ConditionsEditor
                      fields={fields}
                      value={rule.when}
                      onChange={(when) => patchRule(rule.id, { when })}
                      subject="Ce message"
                    />
                    <MessageEditor
                      message={rule.message}
                      onChange={(message) => patchRule(rule.id, { message })}
                      language={language}
                      tokens={tokens}
                      tokenLabels={tokenLabels}
                      scope={rule.id}
                      attachOverride={rule.message.attach_pdf}
                      attachDefault={attachDefault}
                      onAttachOverride={(attach_pdf) =>
                        patchRule(rule.id, { message: { ...rule.message, attach_pdf } })
                      }
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        iconLeft={<Plus className="h-3.5 w-3.5" />}
        onClick={add}
      >
        Ajouter un message conditionnel
      </Button>
    </Section>
  );
}

// ============================================================================
// Aperçu
// ============================================================================

/**
 * L'aperçu passe par la MÊME fonction de rendu que l'envoi.
 *
 * C'est ce qui le rend digne de confiance : un aperçu approximatif est pire que
 * pas d'aperçu, parce qu'on cesse de vérifier le vrai message.
 */
function PreviewSection({
  form,
  config,
  language,
  projectName,
  invoicePrefix
}: {
  form: Form;
  config: EmailConfig;
  language: string;
  projectName?: string;
  invoicePrefix?: string;
}) {
  const preview = useMemo(() => {
    const responses = sampleResponses(form);
    const invoiceNumber = `${invoicePrefix || 'CMD'}-0001`;
    const { message } = chooseEmailMessage(config, responses);
    const context = {
      form,
      responses,
      submittedAt: new Date().toISOString(),
      invoiceNumber,
      projectName,
      pricing: null
    };
    const fallback = fallbackMessage({
      invoiceNumber,
      projectName,
      formTitle: form.title
    });

    const subjectTemplate = pickText(message?.subject, language);
    const bodyTemplate = pickText(message?.body, language);

    return {
      usesFallback: !subjectTemplate && !bodyTemplate,
      subject: subjectTemplate ? renderTemplate(subjectTemplate, context) : fallback.subject,
      body: bodyTemplate
        ? renderTemplate(bodyTemplate, context, { html: true })
        : fallback.html
    };
  }, [form, config, language, projectName, invoicePrefix]);

  return (
    <Section
      title="Aperçu"
      hint="Sur des réponses d'exemple : chaque valeur est le libellé de sa question, entre crochets."
    >
      <div className="overflow-hidden rounded-xl border border-border bg-bg-surface">
        <div className="flex items-center gap-2 border-b border-border bg-bg-base px-4 py-2.5">
          <Mail className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          <p className="min-w-0 truncate text-sm font-medium text-text-primary">
            {preview.subject}
          </p>
        </div>
        <div
          className="prose-email px-4 py-4 text-sm text-text-primary"
          dangerouslySetInnerHTML={{ __html: preview.body }}
        />
      </div>

      {preview.usesFallback && (
        <Hint>
          Rien n&apos;est encore rédigé : c&apos;est ce message de repli qui partirait.
        </Hint>
      )}
    </Section>
  );
}

// ============================================================================
// Écran de remerciement
// ============================================================================

function ConfirmationSection({
  confirmation,
  onChange,
  language,
  invoicingOn
}: {
  confirmation: ConfirmationConfig;
  onChange: (update: Partial<ConfirmationConfig>) => void;
  language: string;
  invoicingOn: boolean;
}) {
  const set = (key: keyof ConfirmationConfig, value: string) => {
    const current = (confirmation[key] ?? { fr: '' }) as MultilingualText;
    onChange({ [key]: { ...current, [language]: value } });
  };

  return (
    <Section
      title="Écran de remerciement"
      hint="Le dernier écran du parcours. Laissé vide, il affiche le texte par défaut."
    >
      <div className="space-y-4">
        <Labelled label="Titre" htmlFor="confirm-title">
          <input
            id="confirm-title"
            value={pickText(confirmation.title, language)}
            onChange={(event) => set('title', event.target.value)}
            placeholder="Merci !"
            maxLength={120}
            className={INPUT}
          />
        </Labelled>

        <Labelled label="Message" htmlFor="confirm-message">
          <textarea
            id="confirm-message"
            rows={3}
            value={pickText(confirmation.message, language)}
            onChange={(event) => set('message', event.target.value)}
            placeholder="Votre inscription est enregistrée. Vous recevez un e-mail de confirmation."
            className="w-full rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden"
          />
          <Hint>Les jetons `{'{{'}…{'}}'}` fonctionnent aussi ici.</Hint>
        </Labelled>

        {invoicingOn && (
          <>
            <div className="flex items-start gap-3 rounded-lg border border-border bg-bg-base p-3">
              <Switch
                checked={confirmation.show_reference !== false}
                onChange={(show_reference) => onChange({ show_reference })}
              />
              <div className="min-w-0">
                <p className="text-sm text-text-primary">Afficher le numéro de commande</p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
                  C&apos;est la référence que le répondant citera s&apos;il vous écrit.
                </p>
              </div>
            </div>

            {confirmation.show_reference !== false && (
              <Labelled label="Libellé du numéro" htmlFor="confirm-reference-label">
                <input
                  id="confirm-reference-label"
                  value={pickText(confirmation.reference_label, language)}
                  onChange={(event) => set('reference_label', event.target.value)}
                  placeholder="Votre numéro de commande"
                  maxLength={80}
                  className={INPUT}
                />
              </Labelled>
            )}
          </>
        )}

        <Labelled label="Mention sous le message" htmlFor="confirm-note">
          <input
            id="confirm-note"
            value={pickText(confirmation.email_note, language)}
            onChange={(event) => set('email_note', event.target.value)}
            placeholder="Un e-mail de confirmation vient de vous être envoyé."
            maxLength={160}
            className={INPUT}
          />
        </Labelled>

        <div className="grid gap-4 sm:grid-cols-2">
          <Labelled label="Libellé du bouton" htmlFor="confirm-button-label">
            <input
              id="confirm-button-label"
              value={pickText(confirmation.button_label, language)}
              onChange={(event) => set('button_label', event.target.value)}
              placeholder="Retour au site"
              maxLength={60}
              className={INPUT}
            />
          </Labelled>
          <Labelled label="Adresse du bouton" htmlFor="confirm-button-url">
            <input
              id="confirm-button-url"
              value={confirmation.button_url ?? ''}
              onChange={(event) => onChange({ button_url: event.target.value })}
              placeholder="https://mooove.group"
              className={INPUT}
            />
            <Hint>Sans adresse, aucun bouton n&apos;est affiché.</Hint>
          </Labelled>
        </div>
      </div>
    </Section>
  );
}

// ============================================================================
// Petits éléments partagés
// ============================================================================

function Section({
  title,
  hint,
  children
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="font-display text-base font-bold text-text-primary">{title}</h3>
      {hint && <p className="mt-1 text-sm leading-relaxed text-text-secondary">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Labelled({
  label,
  htmlFor,
  children
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-xs leading-relaxed text-text-tertiary">{children}</p>;
}

function Notice({
  tone,
  children
}: {
  tone: 'warning' | 'info';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'mt-3 flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm leading-relaxed',
        tone === 'warning'
          ? 'border-warning/40 bg-warning/10 text-text-primary'
          : 'border-border bg-bg-base text-text-secondary'
      )}
    >
      {tone === 'warning' ? (
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      ) : (
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function LanguageTabs({
  languages,
  active,
  onChange
}: {
  languages: string[];
  active: string;
  onChange: (language: string) => void;
}) {
  return (
    <div className="mb-4 inline-flex rounded-md border border-border bg-bg-base p-0.5">
      {languages.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => onChange(code)}
          aria-pressed={code === active}
          className={cn(
            'rounded-sm px-3 py-1 text-xs font-medium transition',
            code === active
              ? 'bg-bg-surface text-text-primary shadow-xs'
              : 'text-text-secondary hover:text-text-primary'
          )}
        >
          {LANGUAGE_NAMES[code] ?? code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function SaveBar({
  dirty,
  saving,
  onCancel,
  onSave
}: {
  dirty: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div
      className={cn(
        'sticky bottom-0 -mx-1 flex items-center justify-between gap-4 rounded-t-xl border-t border-border bg-bg-surface/95 px-5 py-3 backdrop-blur transition-all',
        dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
      )}
    >
      <p className="text-sm text-text-secondary">Modifications non enregistrées</p>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Annuler
        </Button>
        <Button
          variant="cta"
          onClick={onSave}
          disabled={saving}
          iconLeft={
            saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />
          }
        >
          Enregistrer
        </Button>
      </div>
    </div>
  );
}
