'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { ArrowLeft, Eye, Send } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import {
  updateForm,
  getForm
} from '@/lib/store';
import type { Field, FieldType, Form } from '@/types';
import { LIMITS } from '@/lib/constants/limits';
import { toast } from '@/components/ui/Toast';
import { validateForm, canPublishForm, formatValidationErrors } from '@/lib/validation/form-validation';

import { FieldPalette } from '@/components/builder/FieldPalette';
import { SortableFieldCard } from '@/components/builder/FieldCard';
import { FieldSettings } from '@/components/builder/FieldSettings';
import { FormDesignPanel } from '@/components/builder/FormDesignPanel';
import { FormHeader } from '@/components/builder/FormHeader';
import { FormHeaderSettings } from '@/components/builder/FormHeaderSettings';
import { PreviewModal } from '@/components/builder/PreviewModal';
import { getBackgroundStyle } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { FormTheme } from '@/types';

export default function BuilderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [selectedHeaderElement, setSelectedHeaderElement] = useState<'banner' | 'logo' | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  /**
   * Montage de l'aperçu, distinct de son ouverture.
   *
   * L'aperçu était monté en permanence, simplement rendu invisible (`opacity: 0`,
   * `translateY(100%)`). Il restait donc un composant vivant, garé sous le bas de
   * la fenêtre, dont les effets s'exécutaient à chaque changement de formulaire.
   * En basculant le mode d'affichage sur « Pages » ou « Une à une », l'aperçu
   * correspondant se montait et appelait `scrollIntoView` : le navigateur faisait
   * défiler la page jusqu'à ce bloc invisible, et le builder disparaissait de
   * l'écran sans qu'aucun bouton ne permette d'y revenir.
   *
   * Le démontage est différé de la durée de l'animation de fermeture (500 ms),
   * pour que le panneau glisse encore vers le bas avec son contenu.
   */
  const [isPreviewMounted, setIsPreviewMounted] = useState(false);

  useEffect(() => {
    if (isPreviewOpen) {
      setIsPreviewMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setIsPreviewMounted(false), 500);
    return () => window.clearTimeout(timer);
  }, [isPreviewOpen]);

  // Indicateur d'état de sauvegarde (Google Forms / Tally style)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');

  // Système de queue anti-race condition pour l'autosave
  const autosaveQueueRef = useRef<{
    timeout: NodeJS.Timeout | null;
    pendingRequest: Promise<void> | null;
    pendingData: Form | null;
    abortController: AbortController | null;
  }>({
    timeout: null,
    pendingRequest: null,
    pendingData: null,
    abortController: null
  });

  // Refs to prevent race conditions on asynchronous requests
  const lastThemeRequestTimeRef = useRef<number>(0);
  const lastFormRequestTimeRef = useRef<number>(0);
  const lastModeRequestTimeRef = useRef<number>(0);

  // Autosave global avec protection anti-race condition
  const triggerAutosave = useCallback((updatedForm: Form) => {
    setSaveStatus('unsaved');
    const queue = autosaveQueueRef.current;

    // Annuler le timeout précédent s'il existe
    if (queue.timeout) {
      clearTimeout(queue.timeout);
    }

    // Stocker les données les plus récentes
    queue.pendingData = updatedForm;

    // Programmer la sauvegarde
    queue.timeout = setTimeout(async () => {
      // Si une requête est en cours, attendre qu'elle finisse
      if (queue.pendingRequest) {
        try {
          await queue.pendingRequest;
        } catch {
          // Ignorer les erreurs de la requête précédente
        }
      }

      // Utiliser les données les plus récentes
      const dataToSave = queue.pendingData;
      if (!dataToSave) return;

      // Créer un nouveau AbortController pour cette requête
      if (queue.abortController) {
        queue.abortController.abort();
      }
      queue.abortController = new AbortController();

      setSaveStatus('saving');

      // Créer la promesse de sauvegarde - normaliser en Promise pour gérer les modes local et Supabase
      queue.pendingRequest = Promise.resolve(updateForm(dataToSave.id, {
        fields: dataToSave.fields,
        theme: dataToSave.theme,
        title: dataToSave.title,
        description: dataToSave.description,
        display_mode: dataToSave.display_mode,
        scoring_enabled: dataToSave.scoring_enabled,
        status: dataToSave.status,
        published_at: dataToSave.published_at
      })).then(() => {
        // Réinitialiser la queue après succès
        queue.pendingRequest = null;
        queue.pendingData = null;
        queue.abortController = null;
        setSaveStatus('saved');
      }).catch((error: any) => {
        // Ne pas traiter les erreurs d'annulation
        if (error.name === 'AbortError') return;

        console.error('Failed to autosave form:', error);
        toast.error('Erreur lors de la sauvegarde automatique');
        setSaveStatus('unsaved');

        // Réinitialiser la queue après erreur
        queue.pendingRequest = null;
        queue.abortController = null;
      });

      try {
        await queue.pendingRequest;
      } catch {
        // Erreur déjà gérée dans le catch ci-dessus
      }
    }, 1500);
  }, []);

  // Capteur pointer avec un seuil pour ne pas déclencher le drag sur un simple clic
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Helper pour créer un ID unique
  const generateId = useCallback((): string => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }, []);

  /** Cliquer sur un champ le sélectionne. Pour revenir au design global, cliquer dans le vide du canvas. */
  const selectField = useCallback((id: string) => {
    setSelectedFieldId(id);
    setSelectedHeaderElement(null);
  }, []);

  const selectHeaderElement = useCallback((element: 'banner' | 'logo') => {
    setSelectedHeaderElement(element);
    setSelectedFieldId(null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedFieldId(null);
    setSelectedHeaderElement(null);
  }, []);

  const handleFieldChange = useCallback((fieldId: string, patch: Partial<Field>) => {
    if (!form) return;

    const fieldsList = form.fields ?? [];
    const updatedForm = {
      ...form,
      fields: fieldsList.map(f => f.id === fieldId ? { ...f, ...patch } : f)
    };

    setForm(updatedForm);
    triggerAutosave(updatedForm);
  }, [form, triggerAutosave]);

  const handleDuplicate = useCallback((fieldId: string) => {
    if (!form || !form.fields) return;

    const fieldsList = form.fields;
    if (fieldsList.length >= LIMITS.FORM_FIELDS_MAX) {
      toast.error(`Limite de ${LIMITS.FORM_FIELDS_MAX} champs atteinte`);
      return;
    }

    const originalField = fieldsList.find(f => f.id === fieldId);
    if (!originalField) return;

    const idx = fieldsList.findIndex(f => f.id === fieldId);

    const duplicatedField = {
      ...originalField,
      id: generateId(),
      options: originalField.options?.map(o => ({ ...o, id: generateId() })) ?? [],
      field_order: idx + 1
    };

    const newFields = [...fieldsList];
    newFields.splice(idx + 1, 0, duplicatedField);
    const reindexed = newFields.map((f, i) => ({ ...f, field_order: i }));

    const updatedForm = {
      ...form,
      fields: reindexed
    };

    setForm(updatedForm);
    setSelectedFieldId(duplicatedField.id);
    triggerAutosave(updatedForm);
  }, [form, generateId, setSelectedFieldId, triggerAutosave]);

  const handleDelete = useCallback((fieldId: string) => {
    if (!form || !form.fields) return;

    const fieldsList = form.fields;
    const updatedForm = {
      ...form,
      fields: fieldsList.filter(f => f.id !== fieldId)
        .map((f, i) => ({ ...f, field_order: i }))
    };

    setForm(updatedForm);
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
    triggerAutosave(updatedForm);
  }, [form, selectedFieldId, setSelectedFieldId, triggerAutosave]);

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || !form?.fields) return;

    const fieldsList = form.fields;
    const ids = fieldsList.map((f) => f.id);
    const oldIdx = ids.indexOf(active.id as string);
    const newIdx = ids.indexOf(over.id as string);
    if (oldIdx === -1 || newIdx === -1) return;

    const reorderedFields = arrayMove(fieldsList, oldIdx, newIdx)
      .map((f, i) => ({ ...f, field_order: i }));

    const updatedForm = {
      ...form,
      fields: reorderedFields
    };

    setForm(updatedForm);
    triggerAutosave(updatedForm);
  }, [form, triggerAutosave]);

  // Helper pour créer un champ optimiste
  const createOptimisticField = useCallback((type: FieldType, formId: string, currentFieldsCount: number): Field => {
    return {
      id: generateId(),
      form_id: formId,
      type,
      label: { fr: 'Nouvelle question' },
      description: { fr: '' },
      placeholder: { fr: '' },
      options:
        type === 'single_choice' || type === 'multiple_choice' || type === 'dropdown'
          ? [
              { id: generateId(), label: { fr: '' } },
              { id: generateId(), label: { fr: '' } }
            ]
          : type === 'matrix'
            ? [
                { id: generateId(), label: { fr: 'Pas du tout' } },
                { id: generateId(), label: { fr: 'Plutôt non' } },
                { id: generateId(), label: { fr: 'Neutre' } },
                { id: generateId(), label: { fr: 'Plutôt oui' } },
                { id: generateId(), label: { fr: 'Tout à fait' } }
              ]
            : [],
      rows:
        type === 'matrix'
          ? [
              { id: generateId(), label: { fr: 'Critère 1' } },
              { id: generateId(), label: { fr: 'Critère 2' } },
              { id: generateId(), label: { fr: 'Critère 3' } }
            ]
          : undefined,
      required: form?.require_all_by_default ?? false,
      field_order: currentFieldsCount,
      validation: type === 'matrix' ? { matrix_mode: 'single' } : {}
    };
  }, [generateId, form?.require_all_by_default]);

  const handleAdd = useCallback((type: FieldType) => {
    if (!form || (form.fields ?? []).length >= LIMITS.FORM_FIELDS_MAX) {
      toast.error(`Limite de ${LIMITS.FORM_FIELDS_MAX} champs atteinte`);
      return;
    }

    const currentFields = form.fields ?? [];
    const optimisticField = createOptimisticField(type, form.id, currentFields.length);
    const updatedForm = {
      ...form,
      fields: [...currentFields, optimisticField]
    };

    setForm(updatedForm);
    setSelectedFieldId(optimisticField.id);
    triggerAutosave(updatedForm);
  }, [form, createOptimisticField, setSelectedFieldId, triggerAutosave]);

  // Mémorisation des handlers par field ID pour éviter les re-renders
  const fieldHandlers = useMemo(() => {
    const handlers: Record<string, {
      onSelect: () => void;
      onChange: (patch: Partial<Field>) => void;
      onDuplicate: () => void;
      onDelete: () => void;
    }> = {};

    const fieldsList = form?.fields ?? [];
    fieldsList.forEach((field) => {
      handlers[field.id] = {
        onSelect: () => selectField(field.id),
        onChange: (patch: Partial<Field>) => handleFieldChange(field.id, patch),
        onDuplicate: () => handleDuplicate(field.id),
        onDelete: () => handleDelete(field.id)
      };
    });

    return handlers;
  }, [form?.fields, selectField, handleFieldChange, handleDuplicate, handleDelete]);

  // Nettoyer la queue autosave au démontage
  useEffect(() => {
    return () => {
      const queue = autosaveQueueRef.current;
      if (queue.timeout) {
        clearTimeout(queue.timeout);
      }
      if (queue.abortController) {
        queue.abortController.abort();
      }
    };
  }, []);

  // Charger le formulaire initial
  useEffect(() => {
    async function loadForm() {
      setLoading(true);
      try {
        const result = await getForm(params.id);
        setForm(result);
        if (result) setTitleDraft(result.title);
      } catch (error) {
        console.error('Failed to load form:', error);
        setForm(null);
      } finally {
        setLoading(false);
      }
    }
    loadForm();
  }, [params.id]);

  useEffect(() => {
    if (form) {
      setTitleDraft(form.title);
      setDescriptionDraft(form.description ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.id]);

  if (loading) return null;
  if (!form) {
    return (
      <div className="p-20 text-center">
        <h1 className="font-display text-2xl">Formulaire introuvable</h1>
        <Link href="/forms" className="mt-4 inline-block text-accent-bold underline-offset-4 hover:underline">
          ← Retour
        </Link>
      </div>
    );
  }

  const fields = form?.fields ?? [];
  const selected = fields.find((f) => f.id === selectedFieldId) ?? null;

  async function handleTitleBlur() {
    if (!form || !titleDraft || titleDraft === form.title) return;

    const previousForm = form;

    // Update optimiste immédiat
    setForm(prev => prev ? { ...prev, title: titleDraft } : prev);

    // Sauvegarde en arrière-plan
    try {
      const saved = await updateForm(form.id, { title: titleDraft });
      if (saved) setForm(saved);
    } catch (error) {
      console.error('Failed to update title:', error);
      // Rollback en cas d'erreur
      setForm(previousForm);
      setTitleDraft(previousForm.title);
      toast.error('Erreur lors de la modification du titre');
    }
  }

  async function handleDescriptionBlur() {
    if (!form || descriptionDraft === (form.description ?? '')) return;

    const previousForm = form;
    setForm(prev => prev ? { ...prev, description: descriptionDraft } : prev);

    try {
      const saved = await updateForm(form.id, { description: descriptionDraft });
      if (saved) setForm(saved);
    } catch (error) {
      console.error('Failed to update description:', error);
      setForm(previousForm);
      setDescriptionDraft(previousForm.description ?? '');
      toast.error('Erreur lors de la modification de la description');
    }
  }

  async function handlePublish() {
    if (!form) return;

    const previousForm = form;

    // Si on dépublie
    if (form.status === 'published') {
      // Update optimiste immédiat
      setForm(prev => prev ? {
        ...prev,
        status: 'draft' as const,
        published_at: null
      } : prev);

      // Sauvegarde en arrière-plan
      try {
        const saved = await updateForm(form.id, {
          status: 'draft',
          published_at: null
        });
        if (saved) setForm(saved);
      } catch (error) {
        console.error('Failed to unpublish:', error);
        setForm(previousForm);
        toast.error('Erreur lors de la dépublication');
      }
      return;
    }

    // Validation avant publication
    const validationErrors = validateForm(form);

    if (!canPublishForm(form)) {
      // Afficher les erreurs dans un toast
      const errorMessage = formatValidationErrors(validationErrors.filter(e => e.severity === 'error'));
      toast.error(`Impossible de publier :\n${errorMessage}`);

      // Scroll vers le premier champ en erreur
      const firstError = validationErrors.find(e => e.severity === 'error');
      if (firstError) {
        setSelectedFieldId(firstError.fieldId);
        // Scroll vers l'élément après un court délai
        setTimeout(() => {
          const element = document.querySelector(`[data-field-id="${firstError.fieldId}"]`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);
      }
      return;
    }

    // Afficher les avertissements (warnings) s'il y en a
    const warnings = validationErrors.filter(e => e.severity === 'warning');
    if (warnings.length > 0) {
      const warningMessage = formatValidationErrors(warnings);
      toast.warning(`Formulaire publié avec des avertissements :\n${warningMessage}`);
    }

    const publishedAt = new Date().toISOString();

    // Update optimiste immédiat
    setForm(prev => prev ? {
      ...prev,
      status: 'published' as const,
      published_at: publishedAt
    } : prev);

    // Sauvegarde en arrière-plan
    try {
      const saved = await updateForm(form.id, {
        status: 'published',
        published_at: publishedAt
      });
      if (saved) setForm(saved);
      toast.success('Formulaire publié avec succès !');
      router.push(`/forms/${form.id}?tab=share`);
    } catch (error) {
      console.error('Failed to publish:', error);
      setForm(previousForm);
      toast.error('Erreur lors de la publication');
    }
  }

  async function handleThemeChange(patch: Partial<FormTheme>) {
    if (!form) return;

    const requestTime = Date.now();
    lastThemeRequestTimeRef.current = requestTime;

    const previousForm = form;
    let updatedFields = form.fields;

    if (patch.fields_icons_enabled === true && form.fields) {
      updatedFields = form.fields.map(f => {
        if (f.style && 'icon_enabled' in f.style) {
          const { icon_enabled: _removed, ...restStyle } = f.style;
          return { ...f, style: restStyle };
        }
        return f;
      });
    }

    const updateData = {
      theme: { ...form.theme, ...patch },
      ...(patch.fields_icons_enabled === true ? { fields: updatedFields } : {})
    };

    // Synchronize pending queue data to avoid overwriting theme updates
    const queue = autosaveQueueRef.current;
    if (queue.pendingData) {
      queue.pendingData = {
        ...queue.pendingData,
        theme: { ...queue.pendingData.theme, ...patch },
        ...(patch.fields_icons_enabled === true ? { fields: updatedFields } : {})
      };
    }

    // Update optimiste immédiat
    setForm(prev => prev ? { ...prev, ...updateData } : prev);

    // Sauvegarde en arrière-plan
    try {
      const saved = await updateForm(form.id, updateData);
      if (saved && lastThemeRequestTimeRef.current === requestTime) {
        setForm(saved);
      }
    } catch (error) {
      if (lastThemeRequestTimeRef.current === requestTime) {
        console.error('Failed to update theme:', error);
        setForm(previousForm);
        toast.error('Erreur lors de la modification du thème');
      }
    }
  }

  async function handleFormChange(patch: Partial<Form>) {
    if (!form) return;

    const requestTime = Date.now();
    lastFormRequestTimeRef.current = requestTime;

    const previousForm = form;
    let updatedFields = patch.fields ?? form.fields;

    if (patch.theme?.fields_icons_enabled === true && updatedFields) {
      updatedFields = updatedFields.map(f => {
        if (f.style && 'icon_enabled' in f.style) {
          const { icon_enabled: _removed, ...restStyle } = f.style;
          return { ...f, style: restStyle };
        }
        return f;
      });
      patch = { ...patch, fields: updatedFields };
    }

    // Synchronize pending queue data to avoid overwriting form updates
    const queue = autosaveQueueRef.current;
    if (queue.pendingData) {
      queue.pendingData = {
        ...queue.pendingData,
        ...patch
      };
    }

    // Update optimiste immédiat
    setForm(prev => prev ? { ...prev, ...patch } : prev);

    // Sauvegarde en arrière-plan
    try {
      const saved = await updateForm(form.id, patch);
      if (saved && lastFormRequestTimeRef.current === requestTime) {
        setForm(saved);
      }
    } catch (error) {
      if (lastFormRequestTimeRef.current === requestTime) {
        console.error('Failed to update form:', error);
        setForm(previousForm);
        toast.error('Erreur lors de la modification');
      }
    }
  }

  async function handleModeChange(display_mode: import('@/types').DisplayMode) {
    if (!form) return;

    const requestTime = Date.now();
    lastModeRequestTimeRef.current = requestTime;

    const previousForm = form;

    // Synchronize pending queue data to avoid overwriting display mode updates
    const queue = autosaveQueueRef.current;
    if (queue.pendingData) {
      queue.pendingData = {
        ...queue.pendingData,
        display_mode
      };
    }

    // Update optimiste immédiat
    setForm(prev => prev ? { ...prev, display_mode } : prev);

    // Sauvegarde en arrière-plan
    try {
      const saved = await updateForm(form.id, { display_mode });
      if (saved && lastModeRequestTimeRef.current === requestTime) {
        setForm(saved);
      }
    } catch (error) {
      if (lastModeRequestTimeRef.current === requestTime) {
        console.error('Failed to update display mode:', error);
        setForm(previousForm);
        toast.error('Erreur lors du changement de mode');
      }
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between bg-bg-surface px-6 shrink-0 border-b border-border"
        style={{
          height: '3.5rem',
        }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/forms')}
            className="text-text-secondary transition hover:text-text-primary"
            aria-label="Retour"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <div className="relative inline-grid">
              {/* Span miroir invisible — le conteneur prend la largeur du texte réel */}
              <span
                style={{ gridRow: '1', gridColumn: '1' }}
                className="invisible whitespace-pre font-display text-lg pr-8 min-w-[4rem] pointer-events-none select-none"
                aria-hidden="true"
              >
                {titleDraft || ' '}
              </span>
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={handleTitleBlur}
                maxLength={LIMITS.FORM_TITLE_MAX}
                size={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                style={{ gridRow: '1', gridColumn: '1' }}
                className="w-full border-0 bg-transparent font-display text-lg outline-none transition focus:border-b focus:border-accent pr-8"
              />
              {titleDraft.length > LIMITS.FORM_TITLE_MAX * 0.7 && (
                <span className={cn(
                  "absolute right-0 top-1/2 -translate-y-1/2 text-[10px] font-mono pointer-events-none select-none",
                  titleDraft.length > LIMITS.FORM_TITLE_MAX * 0.8 ? "text-red-500 font-semibold" : "text-text-tertiary"
                )}>
                  {titleDraft.length}/{LIMITS.FORM_TITLE_MAX}
                </span>
              )}
            </div>
            {form.status === 'draft' && <Badge variant="draft" className="text-xs px-2 py-1">Brouillon</Badge>}
            {form.status === 'published' && <Badge variant="published" className="text-xs px-2 py-1">Publié</Badge>}
            <span className={cn(
              "text-[11px] font-medium transition-all duration-300 flex items-center gap-1.5",
            saveStatus === 'saved' ? "text-green-600 dark:text-green-400 opacity-80" :
            saveStatus === 'saving' ? "text-amber-500 dark:text-amber-400 font-semibold animate-pulse" :
            "text-text-tertiary"
          )}>
            {saveStatus === 'saved' && (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                Sauvegardé
              </>
            )}
            {saveStatus === 'saving' && (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
                Sauvegarde en cours...
              </>
            )}
            {saveStatus === 'unsaved' && (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                Modifié (en attente...)
              </>
            )}
          </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPreviewOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-mooove-cyan bg-bg-surface px-2.5 py-1.5 text-xs font-medium text-black transition hover:bg-bg-elevated"
          >
            <Eye className="h-3.5 w-3.5" />
            Aperçu
          </button>
          <button
            onClick={handlePublish}
            className="inline-flex items-center gap-1.5 rounded-md border border-mooove-cyan bg-mooove-cyan px-2.5 py-1.5 text-xs font-medium text-black transition hover:bg-mooove-cyan/90"
          >
            <Send className="h-3.5 w-3.5" />
            {form.status === 'published' ? 'Dépublier' : 'Publier'}
          </button>
        </div>
      </div>

      {/* Vue éditeur */}
      <div
        className="flex-1 h-full flex overflow-hidden"
        style={{
          ...getBackgroundStyle(form.theme),
        }}
      >
        {/* Palette */}
        <aside style={{ width: 'var(--palette-width)' }} className="h-full hidden lg:block shrink-0 overflow-y-auto overflow-x-hidden border-r border-border bg-bg-surface">
          <div className="px-3 py-4">
            <FieldPalette onAdd={handleAdd} disabled={fields.length >= LIMITS.FORM_FIELDS_MAX} fieldsCount={fields.length} />
          </div>
        </aside>

        {/* Canvas — clic dans le vide désélectionne (retour au panneau de design) */}
        <div
          className="flex-1 h-full overflow-y-auto overflow-x-hidden transition-colors"
          style={{
            padding: 'var(--layout-padding)',
            ['--accent' as string]: form.theme.accent
          }}
          onClick={(e) => {
            // Ne désélectionner que si on clique vraiment sur le canvas, pas sur ses enfants
            if (e.target === e.currentTarget) {
              clearSelection();
            }
          }}
        >
          <div className="mx-auto max-w-2xl">
            {/* Header fixe avec bannière et logo */}
            <FormHeader
              theme={form.theme}
              selectedElement={selectedHeaderElement}
              onSelectBanner={() => selectHeaderElement('banner')}
              onSelectLogo={() => selectHeaderElement('logo')}
              onThemeChange={handleThemeChange}
            />

            {/* Description éditable */}
            <div className="mt-3 mb-4 px-1">
              <textarea
                value={descriptionDraft}
                onChange={(e) => setDescriptionDraft(e.target.value)}
                onBlur={handleDescriptionBlur}
                maxLength={LIMITS.FORM_DESCRIPTION_MAX}
                placeholder="Ajoutez une description (optionnelle)..."
                rows={2}
                className="w-full resize-none border-0 bg-transparent font-body text-sm italic outline-none transition placeholder:text-text-tertiary focus:border-b focus:border-accent"
                style={{ color: form.theme.text_color ?? 'var(--text-secondary)' }}
              />
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={fields.map((f) => f.id)} strategy={rectSortingStrategy}>
                {fields.length === 0 ? (
                  <EmptyCanvas />
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {fields.map((field, i) => {
                      const handlers = fieldHandlers[field.id];
                      return (
                        <SortableFieldCard
                          key={field.id}
                          field={field}
                          index={i}
                          selected={selectedFieldId === field.id}
                          globalStyle={form.theme.field_style}
                          cardBg={form.theme.field_bg_color}
                          theme={form.theme}
                          scoringEnabled={form.scoring_enabled}
                          onSelect={handlers.onSelect}
                          onChange={handlers.onChange}
                          onDuplicate={handlers.onDuplicate}
                          onDelete={handlers.onDelete}
                        />
                      );
                    })}
                  </div>
                )}
              </SortableContext>
            </DndContext>
          </div>
        </div>

        {/* Settings */}
        <aside style={{ width: 'var(--settings-width)' }} className="h-full hidden lg:block shrink-0 overflow-y-auto overflow-x-hidden border-l border-border bg-bg-surface">
          <div className="px-3 py-4">
            {selected ? (
              <FieldSettings
                form={form}
                field={selected}
                globalStyle={form.theme.field_style}
                onChange={(patch) => handleFieldChange(selected.id, patch)}
                onFormChange={handleFormChange}
              />
            ) : selectedHeaderElement ? (
              <FormHeaderSettings
                theme={form.theme}
                selectedElement={selectedHeaderElement}
                onChange={handleThemeChange}
              />
            ) : (
              <FormDesignPanel
                form={form}
                onChange={handleThemeChange}
                onFormChange={handleFormChange}
                onModeChange={handleModeChange}
              />
            )}
          </div>
        </aside>
      </div>

      {/* APERÇU EN OVERLAY — s'affiche par-dessus le builder avec animation.
          Le contenu n'est monté que pendant l'ouverture : cf. `isPreviewMounted`. */}
      <div
        className="absolute inset-0 z-50 transition-all duration-500 ease-out"
        style={{
          opacity: isPreviewOpen ? 1 : 0,
          pointerEvents: isPreviewOpen ? 'auto' : 'none',
          transform: isPreviewOpen ? 'translateY(0)' : 'translateY(100%)'
        }}
      >
        {isPreviewMounted && (
          <PreviewModal form={form} onClose={() => setIsPreviewOpen(false)} />
        )}
      </div>

    </div>
  );
}

function EmptyCanvas() {
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-bg-surface p-16 text-center">
      <h3 className="font-display text-2xl">Commencez votre Papyrus</h3>
      <p className="papyrus-meta mt-2 text-sm">i. Choisissez un champ dans la palette de gauche</p>
      <div className="mx-auto mt-6 papyrus-divider w-24" />
      <p className="mt-4 text-xs text-text-tertiary">
        14 types disponibles · réorganisez par drag &amp; drop · sauvegarde auto
      </p>
    </div>
  );
}
