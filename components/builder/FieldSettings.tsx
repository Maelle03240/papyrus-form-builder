'use client';

import { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import type { Field, FieldValidation, Form, MultilingualText } from '@/types';
import { FIELD_META } from '@/lib/field-meta';
import { COUNTRIES } from '@/lib/constants/countries';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { OptionsEditor } from './OptionsEditor';
import { StyleEditor } from './StyleEditor';
import { LogicEditor } from './LogicEditor';
import { ConditionsEditor } from './ConditionsEditor';
import { Phase2Settings } from './Phase2Settings';
import { isAnswerable } from '@/lib/submission-format';
import { MatrixEditor } from './MatrixEditor';
import { SubfieldsEditor } from './SubfieldsEditor';
import { Switch } from '@/components/ui/Switch';
import { LIMITS } from '@/lib/constants/limits';
import { getFieldIcon, isIconVisible } from '@/lib/field-icons';
import { useMediaUpload } from '@/lib/hooks/useMediaUpload';

/** Retourne les types de fichiers acceptés par défaut selon le type de champ */
function getDefaultAcceptTypes(type: 'image' | 'video' | 'file'): string {
  switch (type) {
    case 'image': return '.jpg,.jpeg,.png,.gif,.svg';
    case 'video': return '.mp4,.mov,.avi,.mkv';
    case 'file': return '.pdf,.doc,.docx,.xls,.xlsx,.txt';
    default: return '';
  }
}

interface Props {
  form: Form;
  field: Field;
  globalStyle?: import('@/types').FieldStyle;
  onChange: (patch: Partial<Field>) => void;
  onFormChange: (patch: Partial<Form>) => void;
}

type Tab = 'content' | 'style' | 'logic';

/** Lit les dimensions naturelles d'une image déjà téléversée, sans bloquer si elle échoue. */
function readImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function FieldSettings({ form, field, globalStyle, onChange, onFormChange }: Props) {
  const [tab, setTab] = useState<Tab>('content');
  const meta = FIELD_META[field.type];
  /**
   * Une règle de logique part d'une question : elle a besoin d'une réponse à
   * observer. Un verrou de visibilité, lui, vaut pour tout — masquer un bouton
   * « Réserver » tant qu'on n'a pas répondu oui est un usage courant. L'onglet
   * reste donc toujours accessible, et c'est son contenu qui s'adapte.
   */
  const canBeConditionSource = isAnswerable(field);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border pb-3">
        <div className="papyrus-meta text-xs uppercase tracking-wide not-italic">i. {meta.label}</div>
        <p className="mt-1 text-xs text-text-tertiary">{meta.description}</p>
      </div>

      {/* Tabs */}
      <div className="-mx-5 flex border-b border-border bg-bg-surface">
        <TabButton active={tab === 'content'} onClick={() => setTab('content')}>
          Contenu
        </TabButton>
        <TabButton active={tab === 'style'} onClick={() => setTab('style')}>
          Style
        </TabButton>
        <TabButton active={tab === 'logic'} onClick={() => setTab('logic')}>
          Logique
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="flex-1 pt-5">
        {tab === 'content' && <ContentTab form={form} field={field} onChange={onChange} />}
        {tab === 'style' && <StyleEditor field={field} globalStyle={globalStyle} onChange={onChange} />}
        {tab === 'logic' && (
          <div className="space-y-6">
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Affichage conditionnel
              </h3>
              <ConditionsEditor
                fields={form.fields ?? []}
                excludeFieldId={field.id}
                value={field.visibility}
                onChange={(visibility) => onChange({ visibility })}
                subject="Cette question"
              />
            </div>

            {canBeConditionSource && (
              <div className="border-t border-border pt-5">
                <LogicEditor form={form} field={field} onFormChange={onFormChange} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  disabled,
  onClick,
  children
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex-1 border-b-2 px-3 py-2.5 text-xs font-medium uppercase tracking-wide transition',
        active
          ? 'border-accent text-text-primary'
          : 'border-transparent text-text-tertiary hover:text-text-secondary',
        disabled && 'cursor-not-allowed opacity-40 hover:text-text-tertiary'
      )}
    >
      {children}
    </button>
  );
}

// ============================================================================
// Content tab — paramètres standards par type de champ
// ============================================================================

const PICKER_ICONS = [
  'ti-phone', 'ti-mail', 'ti-user', 'ti-star', 'ti-heart', 'ti-map-pin',
  'ti-calendar', 'ti-clock', 'ti-camera', 'ti-file', 'ti-link', 'ti-hash',
  'ti-message', 'ti-checkbox', 'ti-circle-dot', 'ti-info-circle',
  'ti-alert-circle', 'ti-chart-bar', 'ti-home', 'ti-briefcase',
  'ti-pencil', 'ti-tag', 'ti-flag', 'ti-paperclip'
];

const PICKER_EMOJIS = [
  '📞', '✉️', '📅', '⭐', '❤️', '📍', '🕐', '📷', '📎', '🔗',
  '🔢', '💬', '☑️', 'ℹ️', '⚠️', '📊', '🏠', '💼', '✏️', '🏷️'
];

function ContentTab({ form, field, onChange }: { form: Form; field: Field; onChange: (patch: Partial<Field>) => void }) {
  const meta = FIELD_META[field.type];
  const lang = 'fr';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickerTab, setPickerTab] = useState<'icons' | 'emojis'>('icons');
  const {
    upload: uploadImage,
    uploading: uploadingMedia,
    progress: uploadProgress
  } = useMediaUpload();

  function onFieldStyleChange(stylePatch: Partial<import('@/types').FieldStyle>) {
    onChange({ style: { ...field.style, ...stylePatch } });
  }

  function patchMultilingual(key: 'label' | 'description' | 'placeholder', value: string) {
    const current = field[key] ?? ({} as MultilingualText);
    onChange({ [key]: { ...current, [lang]: value } } as Partial<Field>);
  }

  function patchValidation(patch: Partial<FieldValidation>) {
    onChange({ validation: { ...field.validation, ...patch } });
  }

  /**
   * Envoie l'image vers Cloudflare R2, puis lit ses dimensions naturelles depuis
   * l'URL publique pour initialiser le cadrage.
   */
  async function handleImageUpload(file: File) {
    const url = await uploadImage(file);
    if (!url) return;

    const dimensions = await readImageDimensions(url);
    patchValidation({
      media_url: url,
      ...(dimensions && {
        original_width: dimensions.width,
        original_height: dimensions.height,
        image_width: dimensions.width,
        image_height: dimensions.height
      }),
      ratio_locked: true
    });
  }

  const isLayout = field.type === 'statement';
  const _supportsLogic = !isLayout && field.type !== 'image' && field.type !== 'video';

  return (
    <div className="space-y-5">
      {field.type !== 'image' && field.type !== 'video' && (
        <Section title="Contenu">
          <Input
            label={isLayout ? 'Titre' : 'Question'}
            value={field.label?.[lang] ?? ''}
            onChange={(e) => patchMultilingual('label', e.target.value)}
            placeholder={isLayout ? 'Titre de la section' : 'Quelle est votre question ?'}
            maxLength={LIMITS.FIELD_LABEL_MAX}
          />
          <Input
            label={field.type === 'statement' ? 'Texte' : 'Description'}
            value={field.description?.[lang] ?? ''}
            onChange={(e) => patchMultilingual('description', e.target.value)}
            placeholder="Précision optionnelle"
            maxLength={field.type === 'statement' ? LIMITS.STATEMENT_TEXT_MAX : LIMITS.FIELD_DESCRIPTION_MAX}
          />
          {meta.hasPlaceholder && (
            <Input
              label="Placeholder"
              value={field.placeholder?.[lang] ?? ''}
              onChange={(e) => patchMultilingual('placeholder', e.target.value)}
              placeholder="Texte indicatif dans le champ vide"
              maxLength={LIMITS.FIELD_PLACEHOLDER_MAX}
            />
          )}
        </Section>
      )}



      {/* ICÔNE DU CHAMP */}
      <Section title="Icône du champ">
        <Switch
          checked={field.style?.icon_enabled ?? form.theme.fields_icons_enabled ?? false}
          onChange={(v) => onFieldStyleChange({ icon_enabled: v })}
          label="Icône du champ"
          description="Override le réglage global"
        />

        {isIconVisible(field, form.theme) && (
          <div className="mt-4">
            <div className="flex rounded-lg bg-bg-base p-1 border border-border mb-3">
              <button
                type="button"
                onClick={() => setPickerTab('icons')}
                className={cn(
                  "flex-1 rounded-md py-1.5 text-xs font-medium transition",
                  pickerTab === 'icons'
                    ? "bg-bg-surface text-text-primary shadow-xs border border-border"
                    : "text-text-tertiary hover:text-text-secondary"
                )}
              >
                Icônes
              </button>
              <button
                type="button"
                onClick={() => setPickerTab('emojis')}
                className={cn(
                  "flex-1 rounded-md py-1.5 text-xs font-medium transition",
                  pickerTab === 'emojis'
                    ? "bg-bg-surface text-text-primary shadow-xs border border-border"
                    : "text-text-tertiary hover:text-text-secondary"
                )}
              >
                Emoji
              </button>
            </div>

            {pickerTab === 'icons' ? (
              <div className="grid grid-cols-6 gap-2">
                {PICKER_ICONS.map((iconName) => {
                  const currentIcon = field.style?.icon_value ?? getFieldIcon(field);
                  const active = currentIcon === iconName;
                  return (
                    <button
                      key={iconName}
                      type="button"
                      onClick={() => onFieldStyleChange({ icon_value: iconName })}
                      style={{
                        width: 36,
                        height: 36,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 8,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        border: active ? '1.5px solid var(--mooove-cyan)' : '0.5px solid var(--border)',
                        background: active ? 'rgba(42, 194, 222, 0.1)' : 'var(--bg-surface)'
                      }}
                      className="hover:border-accent"
                      title={iconName}
                    >
                      <i className={`ti ${iconName}`} style={{ fontSize: 16, color: active ? 'var(--mooove-cyan)' : 'var(--fg-secondary)' }} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Colle un emoji ici 😊"
                  maxLength={2}
                  value={field.style?.icon_value && !field.style.icon_value.startsWith('ti-') ? field.style.icon_value : ''}
                  onChange={(e) => onFieldStyleChange({ icon_value: e.target.value })}
                  className="w-full rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden"
                />
                <div className="grid grid-cols-10 gap-1.5">
                  {PICKER_EMOJIS.map((emoji) => {
                    const active = field.style?.icon_value === emoji;
                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => onFieldStyleChange({ icon_value: emoji })}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                          height: 28,
                          borderRadius: 6,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          border: active ? '1.5px solid var(--mooove-cyan)' : '0.5px solid var(--border)',
                          background: active ? 'rgba(42, 194, 222, 0.1)' : 'var(--bg-surface)'
                        }}
                        className="hover:border-accent"
                      >
                        {emoji}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {(field.type === 'image' || field.type === 'video' || field.type === 'file') && (
        <MediaSettings
          field={field}
          patchValidation={patchValidation}
          fileInputRef={fileInputRef}
          handleImageUpload={handleImageUpload}
          onChange={onChange}
          uploading={uploadingMedia}
          uploadProgress={uploadProgress}
        />
      )}

      {meta.hasOptions && field.type !== 'matrix' && (
        <Section title="Options">
          <OptionsEditor
            type={field.type as Extract<typeof field.type, 'single_choice' | 'multiple_choice' | 'dropdown'>}
            options={field.options}
            onChange={(options) => onChange({ options })}
            scoringEnabled={form?.scoring_enabled ?? false}
          />
        </Section>
      )}

      {(field.type === 'single_choice' || field.type === 'multiple_choice') && (
        <Section title="Disposition">
          <label className="block text-xs text-text-secondary">Nombre de colonnes</label>
          <div className="grid grid-cols-3 gap-1.5">
            {[1, 2, 3].map((n) => {
              const active = (field.validation?.options_columns ?? 1) === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => patchValidation({ options_columns: n as 1 | 2 | 3 })}
                  className={`rounded-md border py-2 text-sm font-medium transition ${active
                      ? 'border-accent bg-accent/5 text-text-primary'
                      : 'border-border-strong text-text-secondary hover:border-accent'
                    }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-text-tertiary">
            Sur mobile, les options reviennent automatiquement en une colonne.
          </p>
        </Section>
      )}


      {field.type === 'multiple_choice' && (
        <Section title="Limite de sélection">
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              label="Minimum"
              value={field.validation?.selection_min ?? ''}
              onChange={(e) =>
                patchValidation({
                  selection_min: e.target.value === '' ? undefined : Number(e.target.value)
                })
              }
              placeholder="—"
            />
            <Input
              type="number"
              label="Maximum"
              value={field.validation?.selection_max ?? ''}
              onChange={(e) =>
                patchValidation({
                  selection_max: e.target.value === '' ? undefined : Number(e.target.value)
                })
              }
              placeholder="—"
            />
          </div>
          <p className="text-[11px] text-text-tertiary">
            Si renseignées, le répondant ne pourra pas valider hors de cette plage. Laisse vide pour aucune limite.
          </p>
        </Section>
      )}

      {(field.type === 'single_choice' ||
        field.type === 'multiple_choice' ||
        field.type === 'dropdown') && (
          <Section title="Ordre des options">
            <Switch
              checked={field.validation?.randomize_options ?? false}
              onChange={(randomize_options) => patchValidation({ randomize_options })}
              label="Randomiser l'ordre des options"
              description="Mélange aléatoire à chaque chargement pour le répondant. Ton ordre dans le builder reste intact."
            />
          </Section>
        )}

      {field.type === 'multiple_choice' && (
        <Section title="Sous-questions par option cochée">
          <Switch
            checked={field.validation?.has_subfields ?? false}
            onChange={(has_subfields) => patchValidation({ has_subfields })}
            label="Activer les sous-questions"
            description="Une seule série de sous-questions, répétée sous chaque option cochée par le répondant."
          />
          {field.validation?.has_subfields && (
            <SubfieldsEditor
              subfields={field.subfields ?? []}
              onChange={(subfields) => onChange({ subfields })}
            />
          )}
        </Section>
      )}

      {field.type === 'matrix' && (
        <Section title="Matrice">
          <MatrixEditor field={field} onChange={onChange} scoringEnabled={form?.scoring_enabled ?? false} />
        </Section>
      )}

      {field.type === 'phone' && (
        <Section title="Indicatif par défaut">
          <select
            value={field.validation?.default_country ?? 'FR'}
            onChange={(e) => patchValidation({ default_country: e.target.value })}
            className="h-10 w-full rounded-md border border-border-strong bg-bg-surface px-3 text-sm focus:border-accent focus:outline-hidden"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.dialCode})
              </option>
            ))}
          </select>
        </Section>
      )}

      {field.type === 'rating' && (
        <Section title="Échelle">
          <label className="block text-xs text-text-secondary">Nombre d&apos;étoiles</label>
          <select
            value={field.validation?.max ?? 5}
            onChange={(e) => patchValidation({ max: Number(e.target.value) })}
            className="h-10 w-full rounded-md border border-border-strong bg-bg-surface px-3 text-sm focus:border-accent focus:outline-hidden"
          >
            {[3, 5, 7, 10].map((n) => (
              <option key={n} value={n}>
                {n} étoiles
              </option>
            ))}
          </select>
        </Section>
      )}

      {field.type === 'nps' && (
        <>
          <Section title="Échelle">
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                label="Valeur minimale"
                value={field.validation?.min !== undefined ? field.validation.min : 0}
                onChange={(e) =>
                  patchValidation({
                    min: e.target.value === '' ? 0 : Number(e.target.value)
                  })
                }
                placeholder="0"
              />
              <Input
                type="number"
                label="Valeur maximale"
                value={field.validation?.max !== undefined ? field.validation.max : 10}
                onChange={(e) =>
                  patchValidation({
                    max: e.target.value === '' ? 10 : Number(e.target.value)
                  })
                }
                placeholder="10"
              />
            </div>
            <p className="text-[11px] text-text-tertiary">
              Par défaut 0 et 10. Les bornes définissent l&apos;échelle de notation.
            </p>
          </Section>

          <Section title="Libellés des extrémités">
            <div className="space-y-3">
              <Input
                type="text"
                label="Libellé gauche (min)"
                value={field.validation?.nps_left_label !== undefined ? field.validation.nps_left_label : ''}
                onChange={(e) => patchValidation({ nps_left_label: e.target.value })}
                placeholder="Pas du tout probable"
                maxLength={100}
              />
              <Input
                type="text"
                label="Libellé droite (max)"
                value={field.validation?.nps_right_label !== undefined ? field.validation.nps_right_label : ''}
                onChange={(e) => patchValidation({ nps_right_label: e.target.value })}
                placeholder="Extrêmement probable"
                maxLength={100}
              />
            </div>
            <p className="text-[11px] text-text-tertiary">
              Laisser vide pour utiliser les valeurs par défaut.
            </p>
          </Section>

          <Section title="Style d'affichage">
            <label className="block text-xs text-text-secondary">Disposition</label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {([
                { value: 'buttons', label: 'Boutons' },
                { value: 'slider', label: 'Slider' }
              ] as const).map((style) => {
                const active = (field.validation?.display_style ?? 'buttons') === style.value;
                return (
                  <button
                    key={style.value}
                    type="button"
                    onClick={() => patchValidation({ display_style: style.value })}
                    className={`rounded-md border px-2 py-2 text-xs transition ${active
                        ? 'border-accent bg-accent/5 text-text-primary'
                        : 'border-border-strong text-text-secondary hover:border-accent'
                      }`}
                  >
                    {style.label}
                  </button>
                );
              })}
            </div>
          </Section>
        </>
      )}

      {field.type === 'number' && (
        <Section title="Validation">
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              label="Minimum"
              value={field.validation?.min ?? ''}
              onChange={(e) =>
                patchValidation({ min: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
            <Input
              type="number"
              label="Maximum"
              value={field.validation?.max ?? ''}
              onChange={(e) =>
                patchValidation({ max: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </div>
        </Section>
      )}

      {field.type === 'short_text' && (
        <Section title="Type de réponse">
          <div>
            <label className="block text-xs text-text-secondary">Type de réponse</label>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {([
                { value: 'text', label: 'Texte' },
                { value: 'integer', label: 'Nombre entier' },
                { value: 'decimal', label: 'Nombre décimal' }
              ] as const).map((type) => {
                const active = (field.validation?.response_type ?? 'text') === type.value;
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => patchValidation({ response_type: type.value })}
                    className={`rounded-md border px-2 py-2 text-xs transition ${active
                        ? 'border-accent bg-accent/5 text-text-primary'
                        : 'border-border-strong text-text-secondary hover:border-accent'
                      }`}
                  >
                    {type.label}
                  </button>
                );
              })}
            </div>
          </div>

          {(field.validation?.response_type === 'integer' || field.validation?.response_type === 'decimal') && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  label="Minimum"
                  value={field.validation?.min ?? ''}
                  onChange={(e) =>
                    patchValidation({ min: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                  placeholder="—"
                />
                <Input
                  type="number"
                  label="Maximum"
                  value={field.validation?.max ?? ''}
                  onChange={(e) =>
                    patchValidation({ max: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                  placeholder="—"
                />
              </div>

              {field.validation?.response_type === 'decimal' && (
                <div>
                  <label className="block text-xs text-text-secondary">Décimales max</label>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                    {[1, 2, 3].map((n) => {
                      const active = (field.validation?.max_decimals ?? 2) === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => patchValidation({ max_decimals: n })}
                          className={`rounded-md border py-2 text-sm font-medium transition ${active
                              ? 'border-accent bg-accent/5 text-text-primary'
                              : 'border-border-strong text-text-secondary hover:border-accent'
                            }`}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs text-text-secondary">Unité</label>
                <select
                  value={field.validation?.unit ?? 'none'}
                  onChange={(e) => patchValidation({ unit: e.target.value as 'none' | 'euro' | 'dollar' | 'pound' | 'rupee' | 'mur' | 'kg' | 'g' | 'lb' | 'cm' | 'm' | 'ft' | 'in' | 'miles' | 'arpent' | 'percent' })}
                  className="mt-1.5 w-full rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary"
                  disabled={field.validation?.user_can_choose_unit ?? false}
                >
                  <option value="none">Choisir</option>
                  <optgroup label="Devises">
                    <option value="euro">€ Euro</option>
                    <option value="dollar">$ Dollar</option>
                    <option value="pound">£ Livre</option>
                    <option value="rupee">Rs Roupie</option>
                    <option value="mur">MUR Roupie mauricienne</option>
                  </optgroup>
                  <optgroup label="Poids">
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="lb">lb (livre)</option>
                  </optgroup>
                  <optgroup label="Distances">
                    <option value="cm">cm</option>
                    <option value="m">m</option>
                    <option value="ft">ft (pied)</option>
                    <option value="in">in (pouce)</option>
                    <option value="miles">miles</option>
                    <option value="arpent">arpent</option>
                  </optgroup>
                  <optgroup label="Autres">
                    <option value="percent">%</option>
                  </optgroup>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={field.validation?.user_can_choose_unit ?? false}
                  onChange={(checked) => patchValidation({
                    user_can_choose_unit: checked,
                    // Reset l'unité à "none" quand on coche la case
                    ...(checked && { unit: 'none' })
                  })}
                />
                <label className="text-xs text-text-secondary">
                  Laisser le répondant choisir l&apos;unité
                </label>
              </div>
            </>
          )}
        </Section>
      )}

      <Phase2Settings form={form} field={field} onChange={onChange} />
    </div>
  );
}

/** Composant unifié pour les paramètres Image, Vidéo, Fichier */
function MediaSettings({
  field,
  patchValidation,
  fileInputRef,
  handleImageUpload,
  onChange,
  uploading,
  uploadProgress
}: {
  field: Field;
  patchValidation: (patch: Partial<import('@/types').FieldValidation>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleImageUpload: (file: File) => void;
  onChange: (patch: Partial<Field>) => void;
  uploading: boolean;
  uploadProgress: number;
}) {
  const creatorModeEnabled = field.validation?.creator_mode_enabled ?? false;
  const respondentModeEnabled = field.validation?.respondent_mode_enabled ?? false;
  const lang = 'fr';

  // Labels selon le type
  const typeLabels = {
    image: { singular: 'Image', creator: 'Ajouter une image', respondent: 'Demander une image' },
    video: { singular: 'Vidéo', creator: 'Ajouter une vidéo', respondent: 'Demander une vidéo' },
    file: { singular: 'Fichier', creator: 'Ajouter un fichier', respondent: 'Demander un fichier' }
  };

  const labels = typeLabels[field.type as keyof typeof typeLabels];

  function patchMultilingual(key: 'label' | 'description' | 'placeholder', value: string) {
    const current = field[key] ?? ({} as MultilingualText);
    onChange({ [key]: { ...current, [lang]: value } } as Partial<Field>);
  }

  return (
    <div className="space-y-5">
      {/* Section Contenu pour Image, Video et Fichier */}
      {(field.type === 'image' || field.type === 'video' || field.type === 'file') && (
        <Section title="Contenu">
          <Switch
            checked={field.validation?.show_title ?? false}
            onChange={(show_title) => patchValidation({ show_title })}
            label="Afficher un titre"
            description="Ajoute un titre au-dessus du contenu media"
          />
          {field.validation?.show_title && (
            <Input
              label="Titre"
              value={field.label?.[lang] ?? ''}
              onChange={(e) => patchMultilingual('label', e.target.value)}
              placeholder="Titre à afficher au-dessus du contenu"
              maxLength={LIMITS.FIELD_LABEL_MAX}
            />
          )}
        </Section>
      )}

      {/* Info sur les modes sélectionnés */}
      {(creatorModeEnabled || respondentModeEnabled) && (
        <Section title="Modes activés">
          <div className="space-y-2">
            {creatorModeEnabled && (
              <div className="flex items-center gap-2 text-sm">
                <div className="h-2 w-2 rounded-full bg-accent" />
                <span className="text-text-primary">Mode Créateur activé</span>
              </div>
            )}
            {respondentModeEnabled && (
              <div className="flex items-center gap-2 text-sm">
                <div className="h-2 w-2 rounded-full bg-mooove-cyan" />
                <span className="text-text-primary">Mode Répondant activé</span>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Configuration du mode créateur */}
      {creatorModeEnabled && (
        <Section title={`Contenu ${labels.singular.toLowerCase()}`}>
          {field.type === 'video' && (
            <Input
              label="Lien YouTube ou Vimeo"
              value={field.validation?.media_url ?? ''}
              onChange={(e) => patchValidation({ media_url: e.target.value || undefined })}
              placeholder="https://youtube.com/watch?v=..."
            />
          )}

          {field.type === 'image' && (
            <>
              {field.validation?.media_url ? (
                <div className="space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={field.validation.media_url}
                    alt="aperçu"
                    className="max-h-32 w-full rounded-md border border-border bg-bg-base object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => patchValidation({ media_url: undefined })}
                    className="flex items-center gap-1.5 text-xs text-danger hover:underline"
                  >
                    <X className="h-3.5 w-3.5" />
                    Retirer l&apos;image
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-border-strong bg-bg-base px-4 py-6 text-sm text-text-secondary transition hover:border-accent disabled:cursor-wait disabled:opacity-60"
                >
                  <Upload className="h-5 w-5" />
                  {uploading ? `Envoi en cours… ${uploadProgress}%` : 'Téléverser une image'}
                  <span className="text-xs text-text-tertiary">PNG, JPG, WebP, SVG · max 10 Mo</span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImageUpload(f);
                  e.target.value = '';
                }}
              />

              <Input
                label="… ou coller une URL"
                value={
                  field.validation?.media_url?.startsWith('data:')
                    ? ''
                    : field.validation?.media_url ?? ''
                }
                onChange={(e) => {
                  const url = e.target.value || undefined;
                  if (url && !url.startsWith('data:')) {
                    // Tenter de charger l'image pour obtenir ses dimensions
                    const img = new Image();
                    img.onload = () => {
                      patchValidation({
                        media_url: url,
                        original_width: img.naturalWidth,
                        original_height: img.naturalHeight,
                        image_width: img.naturalWidth,
                        image_height: img.naturalHeight,
                        ratio_locked: true
                      });
                    };
                    img.onerror = () => {
                      // Si l'image ne peut pas être chargée, on set juste l'URL
                      patchValidation({ media_url: url });
                    };
                    img.src = url;
                  } else {
                    patchValidation({ media_url: url });
                  }
                }}
                placeholder="https://…"
              />
            </>
          )}

          {field.type === 'file' && (
            <Input
              label="URL du fichier"
              value={field.validation?.media_url ?? ''}
              onChange={(e) => patchValidation({ media_url: e.target.value || undefined })}
              placeholder="https://exemple.com/document.pdf"
            />
          )}

          {/* Alignement pour image et vidéo */}
          {(field.type === 'image' || field.type === 'video') && (
            <div>
              <label className="block text-xs text-text-secondary">Alignement</label>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => patchValidation({ alignment: a })}
                    className={`rounded-md border px-3 py-2 text-xs transition ${(field.validation?.alignment ?? 'center') === a
                        ? 'border-accent bg-accent/5 text-text-primary'
                        : 'border-border-strong text-text-secondary hover:border-accent'
                      }`}
                  >
                    {a === 'left' ? 'Gauche' : a === 'right' ? 'Droite' : 'Centre'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Section Taille avancée pour les images */}
      {field.type === 'image' && creatorModeEnabled && (
        <Section title="Taille">
          <div className="space-y-4">
            {/* Dimensions actuelles */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="number"
                label="Largeur (px)"
                value={field.validation?.image_width ?? ''}
                onChange={(e) => {
                  const width = e.target.value ? parseInt(e.target.value) : undefined;
                  const ratioLocked = field.validation?.ratio_locked ?? true;

                  if (ratioLocked && width && field.validation?.original_width && field.validation?.original_height) {
                    const aspectRatio = field.validation.original_width / field.validation.original_height;
                    const newHeight = Math.round(width / aspectRatio);
                    patchValidation({ image_width: width, image_height: newHeight });
                  } else {
                    patchValidation({ image_width: width });
                  }
                }}
                min={50}
                max={1200}
              />
              <Input
                type="number"
                label="Hauteur (px)"
                value={field.validation?.image_height ?? ''}
                onChange={(e) => {
                  const height = e.target.value ? parseInt(e.target.value) : undefined;
                  const ratioLocked = field.validation?.ratio_locked ?? true;

                  if (ratioLocked && height && field.validation?.original_width && field.validation?.original_height) {
                    const aspectRatio = field.validation.original_width / field.validation.original_height;
                    const newWidth = Math.round(height * aspectRatio);
                    patchValidation({ image_width: newWidth, image_height: height });
                  } else {
                    patchValidation({ image_height: height });
                  }
                }}
                min={30}
                max={800}
              />
            </div>

            {/* Options de ratio */}
            <div className="flex items-center justify-between">
              <Switch
                checked={field.validation?.ratio_locked ?? true}
                onChange={(ratio_locked) => patchValidation({ ratio_locked })}
                label="Verrouiller le ratio"
                description="Maintient les proportions lors du redimensionnement"
              />
            </div>

            {/* Dimensions originales et bouton Reset */}
            {(field.validation?.original_width && field.validation?.original_height) && (
              <div className="rounded-md bg-bg-surface px-3 py-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-text-secondary">Taille originale</p>
                    <p className="text-sm text-text-primary font-medium">
                      {field.validation.original_width} × {field.validation.original_height} px
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      patchValidation({
                        image_width: field.validation?.original_width,
                        image_height: field.validation?.original_height
                      });
                    }}
                    className="px-3 py-1 text-xs text-accent hover:text-accent-dark hover:bg-accent/5 rounded-sm transition"
                  >
                    Réinitialiser
                  </button>
                </div>
              </div>
            )}

            {/* Info sur le redimensionnement */}
            <p className="text-xs text-text-tertiary">
              Vous pouvez aussi redimensionner directement en tirant les poignées autour de l&apos;image dans l&apos;aperçu.
            </p>
          </div>
        </Section>
      )}

      {/* Configuration du mode répondant */}
      {respondentModeEnabled && (
        <Section title="Zone de dépôt">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Formats acceptés"
              value={field.validation?.accept?.join(', ') ?? getDefaultAcceptTypes(field.type as 'image' | 'video' | 'file')}
              onChange={(e) => patchValidation({
                accept: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
              })}
              placeholder=".pdf,.doc,.png"
            />
            <Input
              label="Taille max (MB)"
              type="number"
              value={field.validation?.max_file_size_mb ?? 10}
              onChange={(e) => patchValidation({
                max_file_size_mb: e.target.value ? Number(e.target.value) : undefined
              })}
              min={1}
              max={50}
            />
          </div>
          <p className="text-[11px] text-text-tertiary">
            Les répondants pourront uploader des fichiers respectant ces contraintes
          </p>
        </Section>
      )}
    </div>
  );
}


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 border-t border-dashed border-border pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
