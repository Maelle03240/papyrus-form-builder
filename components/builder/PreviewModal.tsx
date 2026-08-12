'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Monitor, Smartphone, X, GitFork, Eye } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Field, FieldStyle, Form, FormTheme } from '@/types';
import { FieldRenderer } from './FieldRenderer';
import { FormHeader } from './FormHeader';
import { SaveResumeBar } from './SaveResumeBar';
import { FieldContext } from '../public/PublicFieldCard';
import { getBackgroundStyle, getBannerStyle } from '@/lib/theme';
import { getFieldIcon, isIconVisible } from '@/lib/field-icons';
import { buildPages } from '@/lib/sections';
import { cn } from '@/lib/utils';
import { useFormScore } from '@/lib/hooks/useFormScore';
import type { ScoreResult } from '@/lib/scoring';
import { ScoreDisplay } from '@/components/respondent/ScoreDisplay';
import { evaluateLogicRules, evaluateConditions } from '@/lib/logic-evaluation';
import { FormFlowView } from './FormFlowView';
import { toast } from '@/components/ui/Toast';

interface Props {
  form: Form;
  onClose: () => void;
}

type Device = 'desktop' | 'mobile';

export function PreviewModal({ form, onClose }: Props) {
  const [device, setDevice] = useState<Device>('desktop');
  const mode = form.display_mode ?? 'sections';
  const contentRef = useRef<HTMLDivElement>(null);

  // Hook pour gérer le scoring en temps réel
  const {
    responses,
    scoreResult,
    updateResponse,
    showScoreToRespondent
  } = useFormScore(form);

  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());

  const [activeTab, setActiveTab] = useState<'preview' | 'flow'>('preview');

  // Évaluer la visibilité des champs (changement de réponses, structure ou règles)
  useEffect(() => {
    const fields = form.fields || [];
    const newVisibleFields = evaluateLogicRules(
      form.logic_rules || [],
      responses,
      fields
    );
    setVisibleFields(newVisibleFields);
  }, [responses, form.logic_rules, form.fields]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function handleClose() {
    onClose();
  }

  // Propage l'accent du formulaire à toute la modale via une variable CSS — les
  // classes Tailwind `text-accent`, `border-accent`, `bg-accent`, etc. la lisent.
  const accentStyle = { '--accent': form.theme.accent } as React.CSSProperties;

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden isolate" style={{ background: 'var(--papyrus-bg)', ...accentStyle }}>

      {/* Toolbar bien positionnée avec z-index prioritaire et safe zone */}
      <div className="relative z-[100] w-full" style={{ boxSizing: 'border-box' }}>
        <PreviewToolbar 
          form={form} 
          device={device} 
          setDevice={setDevice} 
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onClose={handleClose} 
        />
      </div>

      {/* Animation du parchemin pour le contenu seulement - isolation du stacking context */}
      <div
        className="flex h-[calc(100%-3.5rem)] w-full flex-col relative z-0 min-h-0"
        style={{ transformOrigin: 'top center' }}
      >
        {activeTab === 'preview' && form.save_and_resume && <SaveResumeBar formId={form.id} containerRef={contentRef} />}
        <div 
          ref={contentRef} 
          className="flex-1 overflow-y-auto" 
          style={activeTab === 'preview' ? getBackgroundStyle(form.theme) : { backgroundColor: 'var(--bg-base)' }}
        >
          {activeTab === 'flow' ? (
            <FormFlowView form={form} />
          ) : mode === 'sections' ? (
            <SectionsPreview
              form={form}
              device={device}
              responses={responses}
              updateResponse={updateResponse}
              scoreResult={scoreResult}
              showScoreToRespondent={showScoreToRespondent}
              visibleFields={visibleFields}
            />
          ) : mode === 'typeform' ? (
            <TypeformPreview
              form={form}
              device={device}
              responses={responses}
              updateResponse={updateResponse}
              scoreResult={scoreResult}
              showScoreToRespondent={showScoreToRespondent}
              visibleFields={visibleFields}
            />
          ) : (
            <ScrollPreview
              form={form}
              device={device}
              responses={responses}
              updateResponse={updateResponse}
              scoreResult={scoreResult}
              showScoreToRespondent={showScoreToRespondent}
              visibleFields={visibleFields}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Toolbar
// ============================================================================

function PreviewToolbar({
  form,
  device,
  setDevice,
  activeTab,
  setActiveTab,
  onClose
}: {
  form: Form;
  device: Device;
  setDevice: (d: Device) => void;
  activeTab: 'preview' | 'flow';
  setActiveTab: (t: 'preview' | 'flow') => void;
  onClose: () => void;
}) {
  const mode = form.display_mode ?? 'sections';
  const _modeLabel =
    mode === 'sections' ? 'Pages' : mode === 'typeform' ? 'Une à une' : 'Défilement';

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '0 24px', minHeight: '3.5rem' }}>
      {/* GAUCHE — Onglets de vue */}
      <div style={{ flex: 1, display: 'flex', gap: '8px' }}>
        <button
          type="button"
          onClick={() => setActiveTab('preview')}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition',
            activeTab === 'preview'
              ? 'bg-bg-elevated border-border-strong text-text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          )}
        >
          <Eye size={14} /> Aperçu interactif
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('flow')}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition',
            activeTab === 'flow'
              ? 'bg-bg-elevated border-border-strong text-text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          )}
        >
          <GitFork size={14} /> Flux de logique
        </button>
      </div>

      {/* CENTRE */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        {activeTab === 'preview' && (
          <div className="flex items-center gap-0.5 rounded-md border border-border-strong bg-bg-base p-0.5">
            <DeviceButton active={device === 'desktop'} onClick={() => setDevice('desktop')}>
              <Monitor className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Desktop</span>
            </DeviceButton>
            <DeviceButton active={device === 'mobile'} onClick={() => setDevice('mobile')}>
              <Smartphone className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Mobile</span>
            </DeviceButton>
          </div>
        )}
      </div>

      {/* DROITE — flex:1 + flex-end pour coller à droite */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          style={{
            border: '1.5px solid #2AC2DE',
            color: '#052139',
            background: 'transparent',
            borderRadius: '8px',
            padding: '5px 14px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <X size={14} /> Échap
        </button>
      </div>
    </div>
  );
}

function DeviceButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition',
        active ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}

// ============================================================================
// Header (banner + title)
// ============================================================================

function PreviewHeader({ form }: { form: Form }) {
  return (
    <>
      <FormHeader
        theme={form.theme}
        selectedElement={null}
        onSelectBanner={() => { }}
        onSelectLogo={() => { }}
        preview={true}
      />
      <header className="mb-8">
        <h1 className="font-display text-4xl text-text-primary">{form.title}</h1>
        {form.description && (
          <p
            className="papyrus-meta mt-2 text-base"
            style={{ color: form.theme.text_color ?? 'var(--text-secondary)' }}
          >
            {form.description}
          </p>
        )}
      </header>
    </>
  );
}

// ============================================================================
// Field card (used by Scroll and Sections previews)
// ============================================================================

function PreviewFieldCard({
  field,
  form,
  device,
  span,
  responses,
  updateResponse
}: {
  field: Field;
  form: Form;
  device: Device;
  span: string;
  responses: Record<string, any>;
  updateResponse: (fieldId: string, response: any) => void;
}) {
  if (field.type === 'section_break') {
    // Dans la vue scroll, section_break = séparateur visuel
    return (
      <div key={field.id} className="col-span-full pt-6">
        {field.label.fr && (
          <h2 className="font-display text-2xl text-text-primary flex items-center gap-2">
            {isIconVisible(field, form.theme) && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: 'var(--papyrus-surface)',
                  border: '0.5px solid var(--papyrus-border)',
                  marginRight: 6,
                  flexShrink: 0,
                }}
              >
                {field.style?.icon_value?.startsWith('ti-') ? (
                  <i
                    className={`ti ${field.style.icon_value}`}
                    aria-hidden="true"
                    style={{ fontSize: 20, color: 'var(--accent)' }}
                  />
                ) : field.style?.icon_value ? (
                  <span style={{ fontSize: 22, lineHeight: 1 }}>
                    {field.style.icon_value}
                  </span>
                ) : (
                  <i
                    className={`ti ${getFieldIcon(field)}`}
                    aria-hidden="true"
                    style={{ fontSize: 20, color: 'var(--accent)' }}
                  />
                )}
              </span>
            )}
            <span>{field.label.fr}</span>
          </h2>
        )}
        <div className="papyrus-divider mt-2" />
      </div>
    );
  }

  const isRespondentUpload =
    ['file', 'image', 'video'].includes(field.type) &&
    field.validation?.respondent_mode_enabled === true;

  if (['file', 'image', 'video'].includes(field.type) && !isRespondentUpload) {
    const hasCustomLabel = field.validation?.show_title && field.label.fr && field.label.fr !== 'Nouvelle question';
    if (hasCustomLabel) {
      return (
        <div
          className={cn(
            'min-w-0 rounded-lg border border-border p-5',
            span,
            form.theme.field_bg_color ? '' : 'bg-bg-surface'
          )}
          style={{ backgroundColor: form.theme.field_bg_color }}
        >
          <FieldQuestion field={field} theme={form.theme} globalStyle={form.theme.field_style} />
          <div className="mt-4">
            <FieldRenderer field={field} preview={true} mobile={device === 'mobile'} />
          </div>
        </div>
      );
    }
    return (
      <div className={span}>
        <FieldRenderer field={field} preview={true} mobile={device === 'mobile'} />
      </div>
    );
  }

  if (field.type === 'statement') {
    // Texte libre = bloc informatif, pas une question : pas de carte, pas de bordure,
    // juste un liseré d'accent à gauche pour le différencier visuellement.
    return (
      <div
        className={cn('border-l-2 pl-4 py-1', span)}
        style={{ borderColor: form.theme.accent }}
      >
        {field.label.fr && (
          <h3 className="font-display text-lg text-text-primary">{field.label.fr}</h3>
        )}
        {field.description.fr && (
          <p className="mt-1 whitespace-pre-wrap text-base leading-relaxed text-text-primary">
            {field.description.fr}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'min-w-0 rounded-lg border border-border p-5',
        span,
        form.theme.field_bg_color ? '' : 'bg-bg-surface'
      )}
      style={{ backgroundColor: form.theme.field_bg_color }}
    >
      <FieldQuestion field={field} theme={form.theme} globalStyle={form.theme.field_style} />
      <div className="mt-4">
        <FieldContext.Provider value={field}>
          <FieldRenderer
            field={field}
            preview={false}
            mobile={device === 'mobile'}
            value={responses[field.id]}
            onValueChange={(val) => updateResponse(field.id, val)}
          />
        </FieldContext.Provider>
      </div>
    </div>
  );
}

// ============================================================================
// Scroll Preview
// ============================================================================

function ScrollPreview({
  form,
  device,
  responses,
  updateResponse,
  scoreResult,
  showScoreToRespondent,
  visibleFields
}: {
  form: Form;
  device: Device;
  responses: Record<string, any>;
  updateResponse: (fieldId: string, response: any) => void;
  scoreResult: ScoreResult | null;
  showScoreToRespondent: boolean;
  visibleFields: Set<string>;
}) {
  const fields = (form.fields ?? []).filter(f => visibleFields.has(f.id));
  const hasInputs = fields.some(
    (f) => f.type !== 'section_break' && f.type !== 'image' && f.type !== 'video' && f.type !== 'statement'
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        toast.error('Formulaire envoyé (démo)');
      }}
      className={cn('mx-auto py-12 transition-all', device === 'mobile' ? 'max-w-sm px-4' : 'max-w-2xl px-8')}
    >
      <PreviewHeader form={form} />

      <div className={cn('grid gap-4', device === 'mobile' ? 'grid-cols-1' : 'grid-cols-2')}>
        {fields.length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed border-border-strong bg-bg-surface p-12 text-center">
            <p className="papyrus-meta text-sm">i. Ce formulaire n&apos;a pas encore de champ visible</p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {fields.map((field) => {
            const span =
              device === 'mobile' || (field.layout_width ?? 'full') === 'full' ? 'col-span-2' : 'col-span-1';
            return (
              <motion.div
                key={field.id}
                layout
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className={span}
              >
                <PreviewFieldCard
                  field={field}
                  form={form}
                  device={device}
                  span="w-full"
                  responses={responses}
                  updateResponse={updateResponse}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Affichage du score de maturité si activé */}
      {showScoreToRespondent && scoreResult && scoreResult.maxScore > 0 && (
        <div className="mt-8">
          <ScoreDisplay
            scoreResult={scoreResult}
            scoreLabel={form.theme.score_label}
            scoreDescription={form.theme.score_description}
          />
        </div>
      )}

      {hasInputs && (
        <div className="mt-8 flex justify-end">
          <SubmitButton form={form} type="submit">
            Envoyer
          </SubmitButton>
        </div>
      )}
    </form>
  );
}

// ============================================================================
// Sections Preview (paginated by section_break)
// ============================================================================

function SectionsPreview({
  form,
  device,
  responses,
  updateResponse,
  scoreResult,
  showScoreToRespondent,
  visibleFields
}: {
  form: Form;
  device: Device;
  responses: Record<string, any>;
  updateResponse: (fieldId: string, response: any) => void;
  scoreResult: ScoreResult | null;
  showScoreToRespondent: boolean;
  visibleFields: Set<string>;
}) {
  const fields = (form.fields ?? []).filter(f => visibleFields.has(f.id));
  const pages = buildPages(fields);
  const [pageIdx, setPageIdx] = useState(0);

  const formRef = useRef<HTMLFormElement>(null);
  const isFirstRender = useRef(true);

  /**
   * Remonter en haut à chaque changement de page — mais jamais au montage.
   *
   * `scrollIntoView` fait défiler TOUS les conteneurs ancêtres, y compris ceux
   * qui n'appartiennent pas à l'aperçu. Déclenché au montage, il emportait la
   * page entière du builder.
   */
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    formRef.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' });
  }, [pageIdx]);

  const total = pages.length;

  // Le nombre de pages peut diminuer (logique conditionnelle, suppression d'un
  // champ) alors qu'on se trouve sur l'une des dernières : sans ce recadrage,
  // `pages[pageIdx]` vaut undefined et la page s'affiche vide.
  useEffect(() => {
    if (pageIdx > total - 1) setPageIdx(Math.max(0, total - 1));
  }, [pageIdx, total]);

  const currentPage = pages[Math.min(pageIdx, total - 1)] ?? [];
  const progress = total > 0 ? ((pageIdx + 1) / total) * 100 : 0;
  const isLast = pageIdx === total - 1;
  const isFirst = pageIdx === 0;

  const pageHeader = currentPage[0]?.type === 'section_break' ? currentPage[0] : null;
  const pageFields = pageHeader ? currentPage.slice(1) : currentPage;

  function handleSubmit(e: React.FormEvent) {
    // La validation native HTML5 a déjà filtré les erreurs ici (sinon submit ne fire pas)
    e.preventDefault();
    if (isLast) {
      toast.error('Formulaire envoyé (démo)');
    } else {
      setPageIdx((i) => Math.min(total - 1, i + 1));
    }
  }

  return (
    <form
      ref={formRef}
      key={pageIdx}
      onSubmit={handleSubmit}
      className={cn('mx-auto py-10 transition-all', device === 'mobile' ? 'max-w-sm px-4' : 'max-w-2xl px-8')}
    >
      {/* Progression */}
      <div className="mb-6">
        <div className="mb-1.5 flex items-center justify-between text-xs text-text-secondary">
          <span>
            Page <strong className="text-text-primary">{pageIdx + 1}</strong> sur {total}
          </span>
          {pageHeader?.label.fr && (
            <span className="papyrus-meta text-xs">{pageHeader.label.fr}</span>
          )}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-bg-overlay">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${progress}%`, backgroundColor: form.theme.accent }}
          />
        </div>
      </div>

      {pageIdx === 0 && <PreviewHeader form={form} />}

      {pageHeader?.label.fr && pageIdx > 0 && (
        <div className="mb-6">
          <h2 className="font-display text-3xl text-text-primary flex items-center gap-2">
            {isIconVisible(pageHeader, form.theme) && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: 'var(--papyrus-surface)',
                  border: '0.5px solid var(--papyrus-border)',
                  marginRight: 6,
                  flexShrink: 0,
                }}
              >
                {pageHeader.style?.icon_value?.startsWith('ti-') ? (
                  <i
                    className={`ti ${pageHeader.style.icon_value}`}
                    aria-hidden="true"
                    style={{ fontSize: 20, color: 'var(--accent)' }}
                  />
                ) : pageHeader.style?.icon_value ? (
                  <span style={{ fontSize: 22, lineHeight: 1 }}>
                    {pageHeader.style.icon_value}
                  </span>
                ) : (
                  <i
                    className={`ti ${getFieldIcon(pageHeader)}`}
                    aria-hidden="true"
                    style={{ fontSize: 20, color: 'var(--accent)' }}
                  />
                )}
              </span>
            )}
            <span>{pageHeader.label.fr}</span>
          </h2>
          {pageHeader.description?.fr && (
            <p className="papyrus-meta mt-2 text-base">{pageHeader.description.fr}</p>
          )}
        </div>
      )}

      <div className={cn('grid gap-4', device === 'mobile' ? 'grid-cols-1' : 'grid-cols-2')}>
        {pageFields.length === 0 && pageIdx === 0 && total === 1 && (
          <div className="col-span-full rounded-lg border border-dashed border-border-strong bg-bg-surface p-12 text-center">
            <p className="papyrus-meta text-sm">i. Cette page est vide</p>
          </div>
        )}

        {pageFields.map((field) => {
          const span =
            device === 'mobile' || (field.layout_width ?? 'full') === 'full' ? 'col-span-2' : 'col-span-1';
          return (
            <PreviewFieldCard
              key={field.id}
              field={field}
              form={form}
              device={device}
              span={span}
              responses={responses}
              updateResponse={updateResponse}
            />
          );
        })}
      </div>

      {/* Affichage du score sur la dernière page */}
      {isLast && showScoreToRespondent && scoreResult && scoreResult.maxScore > 0 && (
        <div className="mt-8">
          <ScoreDisplay
            scoreResult={scoreResult}
            scoreLabel={form.theme.score_label}
            scoreDescription={form.theme.score_description}
          />
        </div>
      )}

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
          disabled={isFirst}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-border-strong px-4 py-2 text-sm text-text-primary transition',
            'disabled:cursor-not-allowed disabled:opacity-30',
            'hover:bg-bg-surface'
          )}
        >
          <ArrowLeft className="h-4 w-4" /> Précédent
        </button>

        <SubmitButton form={form} type="submit">
          {isLast ? 'Envoyer' : 'Suivant'}
          {!isLast && <ArrowRight className="h-4 w-4" />}
        </SubmitButton>
      </div>
    </form>
  );
}

// ============================================================================
// Typeform Preview (one question at a time, animated)
// ============================================================================

function TypeformPreview({
  form,
  device,
  responses,
  updateResponse,
  scoreResult,
  showScoreToRespondent,
  visibleFields
}: {
  form: Form;
  device: Device;
  responses: Record<string, any>;
  updateResponse: (fieldId: string, response: any) => void;
  scoreResult: ScoreResult | null;
  showScoreToRespondent: boolean;
  visibleFields: Set<string>;
}) {
  const fields = (form.fields ?? []).filter(f => visibleFields.has(f.id));
  const screens = fields.filter((f) => f.type !== 'section_break');
  const [idx, setIdx] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [history, setHistory] = useState<string[]>([]);

  const formRef = useRef<HTMLFormElement>(null);
  const isFirstRender = useRef(true);

  // Même précaution que dans SectionsPreview : ne jamais faire défiler au
  // montage, sous peine d'emporter la page qui héberge l'aperçu.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    formRef.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' });
  }, [idx]);

  const total = screens.length;
  const current = screens[idx];
  const isLast = idx === total - 1;
  const progress = total > 0 ? ((idx + 1) / total) * 100 : 0;

  const handleNext = () => {
    if (!current) return;

    const fieldRules = (form.logic_rules ?? [])
      .filter((r) => r.conditions && r.conditions.some(c => c.source_field_id === current.id))
      .sort((a, b) => (a.rule_order || 0) - (b.rule_order || 0));

    let triggeredAction: { action_type: string; target_field_id?: string } | null = null;

    for (const rule of fieldRules) {
      if (evaluateConditions(rule.conditions, rule.conditions_operator || 'AND', responses)) {
        triggeredAction = rule;
        break;
      }
    }

    if (triggeredAction) {
      if (triggeredAction.action_type === 'end_form') {
        toast.error('Formulaire envoyé (démo)');
        return;
      }

      if (triggeredAction.action_type === 'jump_to' && triggeredAction.target_field_id) {
        let targetIdx = screens.findIndex(f => f.id === triggeredAction!.target_field_id);
        if (targetIdx === -1) {
          const targetFieldInForm = form.fields?.find(f => f.id === triggeredAction!.target_field_id);
          if (targetFieldInForm) {
            targetIdx = screens.findIndex(f => f.field_order >= targetFieldInForm.field_order);
          }
        }
        if (targetIdx !== -1) {
          setDirection('forward');
          setHistory(prev => [...prev, current.id]);
          setIdx(targetIdx);
          return;
        }
      }
    }

    if (isLast) {
      toast.error('Formulaire envoyé (démo)');
    } else {
      setDirection('forward');
      setHistory(prev => [...prev, current.id]);
      setIdx(idx + 1);
    }
  };

  const handleNextRef = useRef(handleNext);
  useEffect(() => {
    handleNextRef.current = handleNext;
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleNext();
  }

  function prev() {
    if (history.length > 0) {
      const prevId = history[history.length - 1];
      setHistory(prev => prev.slice(0, -1));
      const prevIdx = screens.findIndex(f => f.id === prevId);
      if (prevIdx !== -1) {
        setDirection('back');
        setIdx(prevIdx);
      } else if (idx > 0) {
        setDirection('back');
        setIdx(idx - 1);
      }
    } else if (idx > 0) {
      setDirection('back');
      setIdx(idx - 1);
    }
  }

  // Entrée = soumet le formulaire (déclenche la validation native)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        const target = e.target as HTMLElement;
        const isMultiline = target?.tagName === 'TEXTAREA';
        if (!isMultiline && !e.shiftKey) {
          // Laisse le navigateur soumettre le form courant (validation native s'applique)
          const formEl = (e.target as HTMLElement).closest('form');
          if (formEl) {
            e.preventDefault();
            formEl.requestSubmit();
          }
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (total === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="papyrus-meta text-sm">i. Ce formulaire n&apos;a pas encore de champ</p>
      </div>
    );
  }

  const isStatement = current.type === 'statement';
  const bannerStyle = getBannerStyle(form.theme);

  return (
    <div className="flex h-full flex-col">
      {/* Barre de progression fine tout en haut */}
      <div className="h-1 w-full bg-bg-overlay">
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${progress}%`, backgroundColor: form.theme.accent }}
        />
      </div>

      {/* Bannière visible en haut, sur toutes les slides */}
      {form.theme.banner_url && (
        <div
          className="mx-auto w-full"
          style={{
            maxWidth: device === 'mobile' ? '24rem' : '48rem',
            backgroundColor: (form.theme.banner_fit ?? 'cover') === 'contain' ? '#EFF9FE' : undefined
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={form.theme.banner_url}
            alt="Bannière"
            className={cn('w-full', device === 'mobile' ? 'h-24' : 'h-32')}
            style={bannerStyle}
          />
        </div>
      )}

      {/* Carte centrée — TOUT dedans : numéro, question, champ, Suivant */}
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-8">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.form
            ref={formRef}
            key={current.id}
            onSubmit={handleSubmit}
            custom={direction}
            initial={{ opacity: 0, y: direction === 'forward' ? 40 : -40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: direction === 'forward' ? -40 : 40 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'flex w-full flex-col rounded-xl border bg-bg-surface shadow-sm',
              device === 'mobile' ? 'max-w-sm p-6' : 'max-w-2xl p-10',
              isStatement ? 'border-transparent bg-transparent shadow-none' : 'border-border'
            )}
            style={
              !isStatement && form.theme.field_bg_color
                ? { backgroundColor: form.theme.field_bg_color }
                : undefined
            }
          >
            {/* Titre du formulaire sur la première slide */}
            {idx === 0 && (
              <div className="mb-6">
                <h1 className="font-display text-3xl text-text-primary">{form.title}</h1>
                {form.description && (
                  <p
                    className="papyrus-meta mt-2 text-base"
                    style={{ color: form.theme.text_color ?? 'var(--text-secondary)' }}
                  >
                    {form.description}
                  </p>
                )}
                <div className="papyrus-divider mt-4" />
              </div>
            )}

            {/* En-tête : retour + compteur */}
            <div className="mb-4 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={prev}
                disabled={idx === 0 && history.length === 0}
                className="inline-flex items-center gap-1 text-text-secondary transition hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Retour
              </button>
              <span className="text-text-tertiary">
                <strong className="text-text-secondary">{idx + 1}</strong> / {total}
              </span>
            </div>

            {/* Question + champ (ou texte libre) */}
            <TypeformScreen
              field={current}
              form={form}
              device={device}
              responses={responses}
              updateResponse={(fieldId, val) => {
                updateResponse(fieldId, val);
                if (current.type === 'single_choice' && val !== '__other__' && !isLast) {
                  setTimeout(() => {
                    handleNextRef.current();
                  }, 300);
                }
              }}
            />

            {/* Affichage du score sur la dernière question */}
            {isLast && showScoreToRespondent && scoreResult && scoreResult.maxScore > 0 && (
              <div className="mt-8">
                <ScoreDisplay
                  scoreResult={scoreResult}
                  scoreLabel={form.theme.score_label}
                  scoreDescription={form.theme.score_description}
                />
              </div>
            )}

            {/* Bouton Suivant — toujours en bas de la carte */}
            <div className="mt-8 flex items-center justify-end">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-md px-5 py-2.5 text-sm font-medium text-mooove-ice transition hover:opacity-90"
                style={{ backgroundColor: form.theme.accent }}
              >
                {isStatement ? 'Continuer' : isLast ? 'Envoyer' : 'Suivant'}
                {!isLast && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          </motion.form>
        </AnimatePresence>
      </div>
    </div>
  );
}

function TypeformScreen({
  field,
  form,
  device,
  responses,
  updateResponse
}: {
  field: Field;
  form: Form;
  device: Device;
  responses: Record<string, any>;
  updateResponse: (fieldId: string, response: any) => void;
}) {
  if (field.type === 'image' || field.type === 'video') {
    return <FieldRenderer field={field} preview={false} mobile={device === 'mobile'} />;
  }

  if (field.type === 'statement') {
    // Bloc informatif — pas une question : pas de numérotation ni d'astérisque,
    // titre optionnel discret, corps de texte large et lisible.
    return (
      <div className="text-center">
        {field.label.fr && (
          <h2 className="font-display text-xl italic text-text-secondary">{field.label.fr}</h2>
        )}
        {field.description.fr && (
          <p
            className={cn(
              'whitespace-pre-wrap leading-relaxed text-text-primary',
              field.label.fr ? 'mt-3' : '',
              device === 'mobile' ? 'text-lg' : 'text-2xl'
            )}
          >
            {field.description.fr}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <FieldQuestion field={field} theme={form.theme} globalStyle={form.theme.field_style} />
      <div className="mt-4">
        <FieldRenderer
          field={field}
          preview={false}
          mobile={device === 'mobile'}
          value={responses[field.id]}
          onValueChange={(val) => updateResponse(field.id, val)}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Shared : question header + submit button
// ============================================================================

function FieldQuestion({
  field,
  theme,
  globalStyle
}: {
  field: Field;
  theme?: FormTheme;
  globalStyle?: FieldStyle;
}) {
  const isRespondentUpload =
    ['file', 'image', 'video'].includes(field.type) &&
    field.validation?.respondent_mode_enabled === true;

  const style = { ...(globalStyle ?? {}), ...(field.style ?? {}) };
  const sizeClass = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
    xl: 'text-2xl'
  }[style.label_size ?? 'lg'];
  const fontClass = {
    sans: 'font-sans',
    display: 'font-sans', // alias : aligné sur Aktiv (Mooove)
    serif: 'font-serif',
    mono: 'font-mono'
  }[style.font_family ?? 'sans'];
  const weightClass =
    style.label_weight === 'bold' ? 'font-bold' : style.label_weight === 'medium' ? 'font-medium' : '';

  return (
    <div>
      <div
        className={cn(
          sizeClass,
          fontClass,
          weightClass,
          style.label_italic && 'italic',
          'flex items-center text-text-primary break-words whitespace-pre-wrap'
        )}
        style={{
          color: style.label_color,
          textAlign: style.label_align,
          wordBreak: 'break-word',
          overflowWrap: 'break-word'
        }}
      >
        {theme && isIconVisible(field, theme) && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: 8,
              background: 'var(--papyrus-surface)',
              border: '0.5px solid var(--papyrus-border)',
              marginRight: 8,
              flexShrink: 0,
            }}
          >
            {field.style?.icon_value?.startsWith('ti-') ? (
              <i
                className={`ti ${field.style.icon_value}`}
                aria-hidden="true"
                style={{ fontSize: 20, color: 'var(--accent)' }}
              />
            ) : field.style?.icon_value ? (
              <span style={{ fontSize: 22, lineHeight: 1 }}>
                {field.style.icon_value}
              </span>
            ) : (
              <i
                className={`ti ${getFieldIcon(field)}`}
                aria-hidden="true"
                style={{ fontSize: 20, color: 'var(--accent)' }}
              />
            )}
          </span>
        )}
        <span>
          {field.label.fr || 'Question sans titre'}
          {field.required && <span className="ml-1 text-danger">*</span>}
        </span>
      </div>
      {field.description.fr && (
        <p
          className={cn(
            "papyrus-meta mt-1 text-sm break-words whitespace-pre-wrap",
            isRespondentUpload ? 'italic text-text-tertiary font-normal' : ''
          )}
          style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
        >
          {field.description.fr}
        </p>
      )}
    </div>
  );
}

function SubmitButton({
  form,
  children,
  type = 'button'
}: {
  form: Form;
  children: React.ReactNode;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      className="inline-flex items-center gap-1.5 rounded-md px-5 py-2 text-sm font-medium text-mooove-ice transition hover:opacity-90"
      style={{ backgroundColor: form.theme.accent }}
    >
      {children}
    </button>
  );
}
