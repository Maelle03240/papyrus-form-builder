'use client';

import { useRef, useState, useEffect } from 'react';
import { Image as ImageIcon, Layers, Palette, Sparkles, Upload, X, Plus, Trash2 } from 'lucide-react';
import type {
  BackgroundType,
  DisplayMode,
  Form,
  FormTheme,
  FieldStyle,
  ScoreLevel
} from '@/types';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { BACKGROUND_PRESETS } from '@/lib/theme';
import { DEFAULT_SCORE_LEVELS } from '@/lib/scoring';
import { cn } from '@/lib/utils';
import { StyleControls } from './StyleControls';
import { DebouncedColorInput } from '@/components/ui/DebouncedColorInput';
import { useMediaUpload } from '@/lib/hooks/useMediaUpload';
import { toast } from '@/components/ui/Toast';

interface Props {
  form: Form;
  onChange: (patch: Partial<FormTheme>) => void;
  onFormChange: (patch: Partial<Form>) => void;
  onModeChange: (mode: DisplayMode) => void;
}

type Tab = 'background' | 'style' | 'settings';

export function FormDesignPanel({ form, onChange, onFormChange, onModeChange }: Props) {
  const [tab, setTab] = useState<Tab>('background');
  const currentMode = form.display_mode ?? 'sections';

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border pb-3">
        <div className="papyrus-meta text-xs uppercase tracking-wide not-italic">i. Apparence du formulaire</div>
        <p className="mt-1 text-xs text-text-tertiary">
          Mode d&apos;affichage, couleurs, bannière…
        </p>
      </div>

      {/* Sélecteur de mode d'affichage */}
      <div className="border-b border-border py-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Mode d&apos;affichage
        </h4>
        <div className="space-y-1.5">
          {(
            [
              {
                value: 'sections' as DisplayMode,
                label: 'Pages',
                hint: 'Une section = une page'
              },
              {
                value: 'scroll' as DisplayMode,
                label: 'Défilement',
                hint: 'Tout sur une page (scroll)'
              },
              {
                value: 'typeform' as DisplayMode,
                label: 'Une à une',
                hint: 'Question par question'
              }
            ]
          ).map((m) => {
            const active = currentMode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => onModeChange(m.value)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition',
                  active
                    ? 'border-accent bg-accent/5'
                    : 'border-border-strong hover:border-accent'
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 h-3 w-3 shrink-0 rounded-full border-2',
                    active ? 'border-accent bg-accent' : 'border-border-strong'
                  )}
                />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-text-primary">{m.label}</span>
                  <span className="block text-[11px] text-text-tertiary">{m.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="-mx-5 flex border-b border-border bg-bg-surface">
        <TabButton active={tab === 'background'} onClick={() => setTab('background')}>
          Fond
        </TabButton>
        <TabButton active={tab === 'style'} onClick={() => setTab('style')}>
          Style
        </TabButton>
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
          Réglages
        </TabButton>
      </div>

      <div className="flex-1 pt-5">
        {tab === 'background' && <BackgroundTab theme={form.theme} onChange={onChange} />}
        {tab === 'style' && <FormStyleTab theme={form.theme} onChange={onChange} />}
        {tab === 'settings' && <SettingsTab form={form} onFormChange={onFormChange} />}
      </div>
    </div>
  );
}

// ============================================================================
// Settings tab — comportement du formulaire (save & resume, unique email…)
// ============================================================================

function SettingsTab({ form, onFormChange }: { form: Form; onFormChange: (patch: Partial<Form>) => void }) {
  const hasEmailField = (form.fields ?? []).some((f) => f.type === 'email');
  const uniqueEmail = form.unique_email ?? false;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Icônes du formulaire
        </h4>
        <Switch
          checked={form.theme.fields_icons_enabled ?? false}
          onChange={(v) => onFormChange({ theme: { ...form.theme, fields_icons_enabled: v } })}
          label="Afficher les icônes"
          description="Ajoute une icône à gauche de chaque question"
        />
      </div>

      <div className="space-y-3 border-t border-dashed border-border pt-5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Système de scoring
        </h4>
        <Switch
          checked={form.scoring_enabled ?? false}
          onChange={(scoring_enabled) => onFormChange({ scoring_enabled })}
          label="Activer le système de points"
        />
        {form.scoring_enabled && (
          <>
            <Switch
              checked={form.show_score_to_respondent ?? false}
              onChange={(show_score_to_respondent) => onFormChange({ show_score_to_respondent })}
              label="Afficher le score final au répondant"
              description="Le répondant verra son score total à la fin du formulaire."
            />
            {form.show_score_to_respondent && (
              <div className="mt-2 gap-1.5 space-y-1.5">
                <div>
                  <label className="block text-[10px] text-text-secondary mb-0.5">
                    Nom du score
                  </label>
                  <input
                    value={form.theme.score_label ?? ''}
                    onChange={(e) => onFormChange({ theme: { ...form.theme, score_label: e.target.value } })}
                    placeholder="Score"
                    className="h-7 w-full rounded border border-border bg-bg-surface px-2 text-[11px] text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-text-secondary mb-0.5">
                    Description
                  </label>
                  <input
                    value={form.theme.score_description ?? ''}
                    onChange={(e) => onFormChange({ theme: { ...form.theme, score_description: e.target.value } })}
                    placeholder="Basé sur vos réponses à ce formulaire"
                    className="h-7 w-full rounded border border-border bg-bg-surface px-2 text-[11px] text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Éditeur de niveaux de score */}
            <div className="mt-4 border-t border-dashed border-border pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <h5 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Niveaux de maturité
                </h5>
                <button
                  type="button"
                  onClick={() => {
                    const currentLevels = form.theme.score_levels || [...DEFAULT_SCORE_LEVELS];
                    let nextMin = 0;
                    for (let p = 10; p <= 100; p += 10) {
                      if (!currentLevels.some(l => l.minPercent === p)) {
                        nextMin = p;
                        break;
                      }
                    }
                    const newLevel: ScoreLevel = {
                      minPercent: nextMin,
                      title: 'Nouveau niveau',
                      description: 'Description du niveau...',
                      color: 'blue'
                    };
                    onFormChange({
                      theme: {
                        ...form.theme,
                        score_levels: [...currentLevels, newLevel].sort((a, b) => b.minPercent - a.minPercent)
                      }
                    });
                  }}
                  className="text-xs font-medium text-mooove-cyan hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" /> Ajouter
                </button>
              </div>

              <div className="space-y-3">
                {((form.theme.score_levels && form.theme.score_levels.length > 0)
                  ? form.theme.score_levels
                  : DEFAULT_SCORE_LEVELS
                ).map((level, idx) => {
                  const updateLevel = (patch: Partial<ScoreLevel>) => {
                    const currentLevels = form.theme.score_levels || [...DEFAULT_SCORE_LEVELS];
                    const updated = currentLevels.map((l, i) => i === idx ? { ...l, ...patch } : l);
                    onFormChange({
                      theme: {
                        ...form.theme,
                        score_levels: updated
                      }
                    });
                  };

                  const deleteLevel = () => {
                    const currentLevels = form.theme.score_levels || [...DEFAULT_SCORE_LEVELS];
                    if (currentLevels.length <= 1) {
                      toast.error('Vous devez garder au moins un niveau.');
                      return;
                    }
                    const updated = currentLevels.filter((_, i) => i !== idx);
                    onFormChange({
                      theme: {
                        ...form.theme,
                        score_levels: updated
                      }
                    });
                  };

                  return (
                    <div key={idx} className="rounded border border-border p-2 space-y-1.5 bg-bg-base/30 relative">
                      <button
                        type="button"
                        onClick={deleteLevel}
                        className="absolute top-1.5 right-1.5 text-text-tertiary hover:text-danger transition cursor-pointer"
                        title="Supprimer ce niveau"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>

                      <div className="grid grid-cols-[60px_1fr] gap-1.5 items-center">
                        <label className="text-[10px] text-text-secondary">Min %</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={level.minPercent}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                            updateLevel({ minPercent: val });
                          }}
                          className="h-6 rounded border border-border bg-bg-surface px-1.5 text-[11px] focus:border-accent focus:outline-none w-16"
                        />
                      </div>

                      <div className="grid grid-cols-[60px_1fr] gap-1.5 items-center">
                        <label className="text-[10px] text-text-secondary">Titre</label>
                        <input
                          type="text"
                          value={level.title}
                          onChange={(e) => updateLevel({ title: e.target.value })}
                          className="h-6 rounded border border-border bg-bg-surface px-1.5 text-[11px] focus:border-accent focus:outline-none w-full"
                        />
                      </div>

                      <div className="grid grid-cols-[60px_1fr] gap-1.5 items-start">
                        <label className="text-[10px] text-text-secondary pt-1">Description</label>
                        <textarea
                          value={level.description}
                          onChange={(e) => updateLevel({ description: e.target.value })}
                          className="h-12 rounded border border-border bg-bg-surface p-1.5 text-[11px] focus:border-accent focus:outline-none w-full resize-none leading-tight"
                        />
                      </div>

                      <div className="grid grid-cols-[60px_1fr] gap-1.5 items-center">
                        <label className="text-[10px] text-text-secondary">Couleur</label>
                        <select
                          value={level.color}
                          onChange={(e) => updateLevel({ color: e.target.value as any })}
                          className="h-6 rounded border border-border bg-bg-surface px-1.5 text-[11px] focus:border-accent focus:outline-none w-28"
                        >
                          <option value="green">Vert (Excellent)</option>
                          <option value="blue">Bleu (Bien)</option>
                          <option value="orange">Orange (Moyen)</option>
                          <option value="red">Rouge (À développer)</option>
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="space-y-3 border-t border-dashed border-border pt-5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Anti-doublon
        </h4>
        <Switch
          checked={uniqueEmail}
          onChange={(unique_email) => onFormChange({ unique_email })}
          label="Un seul envoi par personne (email)"
          description="Avant l'envoi final, on vérifie que cet email n'a pas déjà répondu à ce formulaire."
        />
        {uniqueEmail && !hasEmailField && (
          <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
            i. Cette option nécessite un champ <strong>Email</strong> dans le formulaire. Ajoutes-en un depuis la palette de gauche.
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-dashed border-border pt-5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Sauvegarde et reprise
        </h4>
        <Switch
          checked={form.save_and_resume ?? false}
          onChange={(save_and_resume) => onFormChange({ save_and_resume })}
          label="Permettre la reprise d'une réponse en cours"
          description="Les réponses en cours sont enregistrées dans le navigateur. Si le répondant revient, on lui propose de reprendre où il s'était arrêté. Aucune donnée n'est envoyée tant que le formulaire n'est pas soumis."
        />
      </div>

      <div className="space-y-3 border-t border-dashed border-border pt-5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Questions obligatoires
        </h4>
        <Switch
          checked={form.require_all_by_default ?? false}
          onChange={(require_all_by_default) => onFormChange({ require_all_by_default })}
          label="Questions obligatoires par défaut"
          description="Les nouveaux champs ajoutés seront marqués comme obligatoires par défaut"
        />
      </div>

      <div className="space-y-3 border-t border-dashed border-border pt-5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Date de clôture
        </h4>
        <Switch
          checked={!!form.closes_at}
          onChange={(checked) => {
            if (checked) {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              const localIsoString = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
              onFormChange({ closes_at: localIsoString });
            } else {
              onFormChange({ closes_at: null });
            }
          }}
          label="Définir une date de clôture"
          description="Le formulaire sera automatiquement fermé aux répondants après cette date."
        />
        {form.closes_at && (
          <div className="mt-2">
            <input
              type="datetime-local"
              value={form.closes_at.slice(0, 16)}
              onChange={(e) => onFormChange({ closes_at: e.target.value })}
              className="h-10 w-full rounded-md border border-border-strong bg-bg-surface px-3 text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 border-b-2 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide transition',
        active ? 'border-accent text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary'
      )}
    >
      {children}
    </button>
  );
}

// ============================================================================
// Background tab
// ============================================================================

const BG_TYPES: { value: BackgroundType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'preset', label: 'Preset', icon: Sparkles },
  { value: 'color', label: 'Couleur', icon: Palette },
  { value: 'gradient', label: 'Dégradé', icon: Layers },
  { value: 'image', label: 'Image', icon: ImageIcon }
];

const BLOCK_PRESETS: { value: string | undefined; label: string; preview: string }[] = [
  { value: undefined, label: 'Défaut', preview: '#FFFFFF' },
  { value: '#FFFFFF', label: 'Blanc', preview: '#FFFFFF' },
  { value: '#C7EAFB', label: 'Sky', preview: '#C7EAFB' },
  { value: '#EFF9FE', label: 'Ice', preview: '#EFF9FE' },
  { value: 'transparent', label: 'Transparent', preview: 'transparent' },
  { value: '#0A3050', label: 'Sombre', preview: '#0A3050' }
];

function BackgroundTab({ theme, onChange }: { theme: FormTheme; onChange: (patch: Partial<FormTheme>) => void }) {
  const type: BackgroundType = theme.bg_type ?? 'color';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { upload: uploadImage, uploading, progress } = useMediaUpload();

  const [localGradientAngle, setLocalGradientAngle] = useState(theme.bg_gradient_angle ?? 135);
  const [localImageOpacity, setLocalImageOpacity] = useState(theme.bg_image_opacity ?? 0);

  useEffect(() => {
    setLocalGradientAngle(theme.bg_gradient_angle ?? 135);
  }, [theme.bg_gradient_angle]);

  useEffect(() => {
    setLocalImageOpacity(theme.bg_image_opacity ?? 0);
  }, [theme.bg_image_opacity]);

  /** L'image de fond part sur Cloudflare R2 ; on ne stocke que son URL publique. */
  async function handleImageUpload(file: File) {
    const url = await uploadImage(file);
    if (!url) return;
    onChange({ bg_type: 'image', bg_image_url: url, bg: `url(${url})` });
  }

  return (
    <div className="space-y-5">
      {/* === SECTION 1 : ARRIÈRE-PLAN DE LA PAGE === */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Arrière-plan de la page
        </h4>
      </div>

      {/* Type selector */}
      <div className="grid grid-cols-4 gap-1.5">
        {BG_TYPES.map((t) => {
          const Icon = t.icon;
          const active = type === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => onChange({ bg_type: t.value })}
              className={cn(
                'flex flex-col items-center gap-1 rounded-md border p-2 transition',
                active
                  ? 'border-accent bg-accent/5'
                  : 'border-border-strong text-text-secondary hover:border-accent'
              )}
            >
              <Icon className={cn('h-4 w-4', active && 'text-text-primary')} />
              <span className="text-[10px]">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* PRESET */}
      {type === 'preset' && (
        <div className="grid grid-cols-2 gap-2">
          {BACKGROUND_PRESETS.map((p) => {
            const active = theme.bg_preset === p.id;
            const previewStyle = p.apply.bg_type === 'gradient'
              ? {
                  backgroundImage: `linear-gradient(${p.apply.bg_gradient_angle ?? 135}deg, ${p.apply.bg_gradient_from}, ${p.apply.bg_gradient_to})`
                }
              : { backgroundColor: p.apply.bg_color ?? p.apply.bg };
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onChange({ ...p.apply, bg_preset: p.id })}
                className={cn(
                  'overflow-hidden rounded-md border transition',
                  active ? 'border-accent ring-2 ring-accent/30' : 'border-border-strong hover:border-accent'
                )}
              >
                <div className="h-14" style={previewStyle} />
                <div className="px-2 py-1.5 text-left text-xs text-text-secondary">{p.label}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* COLOR */}
      {type === 'color' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <DebouncedColorInput
              value={theme.bg_color ?? theme.bg ?? '#EFF9FE'}
              onChange={(val) => onChange({ bg_color: val, bg: val })}
              className="h-9 w-12 cursor-pointer rounded border border-border-strong bg-bg-base"
            />
            <Input
              value={theme.bg_color ?? theme.bg ?? ''}
              onChange={(e) => onChange({ bg_color: e.target.value, bg: e.target.value })}
              placeholder="#EFF9FE"
              className="flex-1 font-mono text-xs h-9 px-3"
            />
          </div>
        </div>
      )}

      {/* GRADIENT */}
      {type === 'gradient' && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-text-secondary">Couleur 1</label>
            <div className="flex items-center gap-2">
              <DebouncedColorInput
                value={theme.bg_gradient_from ?? '#EFF9FE'}
                onChange={(val) => onChange({ bg_gradient_from: val })}
                className="h-9 w-12 cursor-pointer rounded border border-border-strong bg-bg-base"
              />
              <Input
                value={theme.bg_gradient_from ?? ''}
                onChange={(e) => onChange({ bg_gradient_from: e.target.value })}
                placeholder="#EFF9FE"
                className="flex-1 font-mono text-xs h-9 px-3"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-secondary">Couleur 2</label>
            <div className="flex items-center gap-2">
              <DebouncedColorInput
                value={theme.bg_gradient_to ?? '#EFF9FE'}
                onChange={(val) => onChange({ bg_gradient_to: val })}
                className="h-9 w-12 cursor-pointer rounded border border-border-strong bg-bg-base"
              />
              <Input
                value={theme.bg_gradient_to ?? ''}
                onChange={(e) => onChange({ bg_gradient_to: e.target.value })}
                placeholder="#EFF9FE"
                className="flex-1 font-mono text-xs h-9 px-3"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 flex items-center justify-between text-xs text-text-secondary">
              <span>Angle</span>
              <span className="font-mono text-text-tertiary">{localGradientAngle}°</span>
            </label>
            <input
              type="range"
              min={0}
              max={360}
              value={localGradientAngle}
              onChange={(e) => setLocalGradientAngle(Number(e.target.value))}
              onMouseUp={(e) => onChange({ bg_gradient_angle: Number(e.currentTarget.value) })}
              onTouchEnd={(e) => onChange({ bg_gradient_angle: Number(e.currentTarget.value) })}
              onKeyUp={(e) => onChange({ bg_gradient_angle: Number(e.currentTarget.value) })}
              className="w-full accent-mooove-navy"
            />
          </div>
        </div>
      )}

      {/* IMAGE */}
      {type === 'image' && (
        <div className="space-y-3">
          {theme.bg_image_url ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={theme.bg_image_url}
                alt="Aperçu fond"
                className="h-24 w-full rounded-md border border-border object-cover"
              />
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-text-secondary hover:underline"
                >
                  Remplacer
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ bg_image_url: undefined })}
                  className="flex items-center gap-1 text-xs text-danger hover:underline"
                >
                  <X className="h-3 w-3" /> Retirer
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-border-strong bg-bg-base px-4 py-6 text-sm text-text-secondary transition hover:border-accent disabled:cursor-wait disabled:opacity-60"
            >
              <Upload className="h-5 w-5" />
              {uploading ? `Envoi en cours… ${progress}%` : 'Téléverser une image de fond'}
              <span className="text-xs text-text-tertiary">PNG, JPG, WebP · max 10 Mo</span>
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
            value={theme.bg_image_url?.startsWith('data:') ? '' : theme.bg_image_url ?? ''}
            onChange={(e) => onChange({ bg_image_url: e.target.value || undefined })}
            placeholder="https://…"
            className="h-9 px-3 text-xs"
          />

          <div>
            <label className="mb-1 flex items-center justify-between text-xs text-text-secondary">
              <span>Voile clair (lisibilité)</span>
              <span className="font-mono text-text-tertiary">{localImageOpacity}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={90}
              value={localImageOpacity}
              onChange={(e) => setLocalImageOpacity(Number(e.target.value))}
              onMouseUp={(e) => onChange({ bg_image_opacity: Number(e.currentTarget.value) })}
              onTouchEnd={(e) => onChange({ bg_image_opacity: Number(e.currentTarget.value) })}
              onKeyUp={(e) => onChange({ bg_image_opacity: Number(e.currentTarget.value) })}
              className="w-full accent-mooove-navy"
            />
            <p className="mt-1 text-[10px] text-text-tertiary">
              Adoucit l&apos;image pour que le texte reste lisible.
            </p>
          </div>
        </div>
      )}

      {/* === SECTION 2 : COULEUR DES BLOCS === */}
      <div className="border-t border-dashed border-border pt-5">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Couleur des blocs
        </h4>
        <p className="mb-3 text-xs text-text-tertiary">
          Couleur de fond des cartes contenant les questions.
        </p>

        <div className="grid grid-cols-3 gap-2">
          {BLOCK_PRESETS.map((p) => {
            const active = (theme.field_bg_color ?? undefined) === p.value;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => onChange({ field_bg_color: p.value })}
                className={cn(
                  'overflow-hidden rounded-md border transition',
                  active ? 'border-accent ring-2 ring-accent/30' : 'border-border-strong hover:border-accent'
                )}
              >
                <div
                  className="h-10 border-b border-border"
                  style={{
                    backgroundColor: p.preview === 'transparent' ? undefined : p.preview,
                    backgroundImage:
                      p.preview === 'transparent'
                        ? 'linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%), linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%)'
                        : undefined,
                    backgroundSize: p.preview === 'transparent' ? '8px 8px' : undefined,
                    backgroundPosition: p.preview === 'transparent' ? '0 0, 4px 4px' : undefined
                  }}
                />
                <div className="px-2 py-1 text-left text-[11px] text-text-secondary">{p.label}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <DebouncedColorInput
            value={theme.field_bg_color ?? '#FFFFFF'}
            onChange={(val) => onChange({ field_bg_color: val })}
            className="h-9 w-12 cursor-pointer rounded border border-border-strong bg-bg-base"
          />
          <Input
            value={theme.field_bg_color ?? ''}
            onChange={(e) => onChange({ field_bg_color: e.target.value || undefined })}
            placeholder="par défaut"
            className="flex-1 font-mono text-xs h-9 px-3"
          />
        </div>
      </div>
    </div>
  );
}


// ============================================================================
// Form style tab — applique à TOUTES les questions du formulaire
// ============================================================================

function FormStyleTab({
  theme,
  onChange
}: {
  theme: FormTheme;
  onChange: (patch: Partial<FormTheme>) => void;
}) {
  const current = theme.field_style ?? {};
  const hasStyle = Object.keys(current).length > 0;

  function handleChange(next: FieldStyle) {
    onChange({ field_style: Object.keys(next).length === 0 ? undefined : next });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-mooove-cyan/30 bg-mooove-cyan/5 px-2.5 py-2 text-[11px] text-text-secondary">
        Le style choisi ici s&apos;applique à <strong>toutes les questions</strong> du formulaire. Vous pouvez toujours
        le surcharger champ par champ via l&apos;onglet « Style » d&apos;un champ sélectionné.
      </div>

      <StyleControls
        style={current}
        onChange={handleChange}
        introColor={theme.text_color}
        onIntroColorChange={(c) => onChange({ text_color: c })}
      />

      {hasStyle && (
        <button
          type="button"
          onClick={() => onChange({ field_style: undefined })}
          className="w-full rounded-md border border-dashed border-border-strong py-2 text-xs text-text-secondary hover:border-danger hover:text-danger mt-3"
        >
          Réinitialiser le style global
        </button>
      )}

      {/* Couleur des boutons */}
      <div className="border-t border-dashed border-border pt-5 space-y-2">
        <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Couleur des boutons
        </label>
        <div className="grid grid-cols-8 gap-0.5 mb-2">
          {PRESET_ACCENTS.map((c) => {
            const active = theme.accent === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => onChange({ accent: c })}
                className={cn(
                  'h-5 w-5 rounded border transition',
                  active ? 'ring-1 ring-accent ring-offset-1 ring-offset-bg-surface' : 'border-border'
                )}
                style={{ backgroundColor: c }}
                aria-label={`Couleur ${c}`}
              />
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <DebouncedColorInput
            value={theme.accent ?? '#052139'}
            onChange={(val) => onChange({ accent: val })}
            className="h-9 w-12 cursor-pointer rounded border border-border-strong bg-bg-base"
            aria-label="Couleur des boutons"
          />
          <Input
            value={theme.accent ?? ''}
            onChange={(e) => onChange({ accent: e.target.value })}
            placeholder="#052139"
            className="flex-1 font-mono text-xs h-9 px-3"
          />
        </div>
      </div>
    </div>
  );
}

const PRESET_ACCENTS = [
  '#052139', // Navy
  '#3C5EAB', // Electric Blue
  '#2AC2DE', // Cyan
  '#F6923E', // Amber
  '#C0392B', // Coral
  '#10B981', // Emerald
  '#8B5CF6', // Purple
  '#EC4899'  // Pink
];

