'use client';

import { Component, useState, useEffect, useMemo, type ReactNode, type RefObject } from 'react';
import { Award, BarChart3, Download, TrendingUp } from 'lucide-react';
import { GridLayout, useContainerWidth, verticalCompactor } from 'react-grid-layout';
import type { Layout, LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell
} from 'recharts';
import { Button } from '@/components/ui/Button';
import { ChartWidget } from '@/components/dashboard/ChartWidget';
import { updateForm } from '@/lib/store';

import { toast } from '@/components/ui/Toast';
import { calculateFormScore, DEFAULT_SCORE_LEVELS } from '@/lib/scoring';
import type { Form, Field, ChartLayoutItem } from '@/types';

/**
 * Onglet Insights — graphiques par question, disposés sur une grille
 * réorganisable.
 *
 * S'appelait « Overview » et vivait dans la page `/forms/[id]`. Extrait tel quel
 * pour que l'espace de travail d'un projet le monte sans le réécrire.
 */
function getOrderedChartFields(fields: Field[], chartOrder?: string[], deletedCharts?: string[]): Field[] {
  const activeFields = fields.filter(
    f => !['section_break', 'statement', 'image', 'video', 'file'].includes(f.type) &&
         !(deletedCharts ?? []).includes(f.id)
  );

  if (!chartOrder || chartOrder.length === 0) {
    return [...activeFields].sort((a, b) => a.field_order - b.field_order);
  }

  const sorted: Field[] = [];
  chartOrder.forEach(id => {
    const found = activeFields.find(f => f.id === id);
    if (found) {
      sorted.push(found);
    }
  });

  activeFields.forEach(f => {
    if (!sorted.some(s => s.id === f.id)) {
      sorted.push(f);
    }
  });

  return sorted;
}

// ============================================================================
// Construit le layout initial pour react-grid-layout.
// Si chart_layout est déjà stocké, on l'utilise.
// Sinon on génère des positions à partir de orderedFields (qui respecte déjà chart_order).
// ============================================================================
function buildInitialLayout(
  orderedFields: Field[],
  storedLayout: ChartLayoutItem[] | undefined
): LayoutItem[] {
  if (storedLayout && storedLayout.length > 0) {
    return orderedFields.map((field, index) => {
      const stored = storedLayout.find(item => item.field_id === field.id);
      if (stored) return { i: field.id, x: stored.x, y: stored.y, w: stored.w, h: stored.h };
      // Nouveau champ pas encore dans le layout — on l'ajoute en bas
      return { i: field.id, x: index % 2, y: Infinity, w: 1, h: 4 };
    });
  }
  // Pas de layout stocké — on génère depuis l'ordre actuel (respecte chart_order via orderedFields)
  return orderedFields.map((field, index) => ({
    i: field.id,
    x: index % 2,
    y: Math.floor(index / 2) * 4,
    w: 1,
    h: 4,
  }));
}

// ============================================================================
// Générateur HTML standalone — export du formulaire
// ============================================================================
function generateFormHTML(form: Form): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const t = (ml: { fr: string; en?: string } | undefined) =>
    ml ? (ml.fr || ml.en || '') : '';

  const renderField = (field: Field): string => {
    const label = esc(t(field.label));
    const desc = t(field.description);
    const placeholder = esc(t(field.placeholder));
    const req = field.required ? '<span class="req">*</span>' : '';

    switch (field.type) {
      case 'short_text':
      case 'email':
      case 'phone':
      case 'url':
      case 'number':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}<input type="${field.type === 'short_text' ? 'text' : field.type}" placeholder="${placeholder}"></div>`;
      case 'long_text':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}<textarea rows="4" placeholder="${placeholder}"></textarea></div>`;
      case 'date':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}<input type="date"></div>`;
      case 'single_choice':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}${(field.options || []).map(o => `<label class="choice"><input type="radio" name="${esc(field.id)}"><span>${esc(t(o.label))}</span></label>`).join('')}</div>`;
      case 'multiple_choice':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}${(field.options || []).map(o => `<label class="choice"><input type="checkbox"><span>${esc(t(o.label))}</span></label>`).join('')}</div>`;
      case 'dropdown':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}<select><option value="">— Choisir —</option>${(field.options || []).map(o => `<option>${esc(t(o.label))}</option>`).join('')}</select></div>`;
      case 'rating':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}<div class="rating">☆ ☆ ☆ ☆ ☆</div></div>`;
      case 'nps':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}<div class="nps">${Array.from({ length: 11 }, (_, i) => `<span>${i}</span>`).join('')}</div></div>`;
      case 'section_break':
        return `<div class="section-break"><hr><h3>${label}</h3></div>`;
      case 'statement':
        return `<p class="statement">${label}</p>`;
      default:
        return '';
    }
  };

  const sortedFields = [...(form.fields || [])].sort((a, b) => a.field_order - b.field_order);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(form.title)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#EFF9FE;color:#1a1a1a;min-height:100vh;display:flex;justify-content:center;padding:40px 16px}
    .wrap{background:#FFFFFF;border-radius:16px;padding:48px;max-width:680px;width:100%;border:1px solid #C7EAFB}
    h1{font-size:2rem;font-weight:700;margin-bottom:8px}
    .form-desc{color:#666;margin-bottom:40px;line-height:1.6}
    .field{margin-bottom:28px}
    label{display:block;font-weight:600;font-size:.95rem;margin-bottom:8px}
    .req{color:#e05;margin-left:3px}
    .desc{font-size:.83rem;color:#777;margin-bottom:8px;font-weight:400}
    input[type=text],input[type=email],input[type=tel],input[type=url],input[type=number],input[type=date],textarea,select{width:100%;padding:10px 14px;border:1.5px solid #C7EAFB;border-radius:8px;font-size:.95rem;background:#fff;font-family:inherit}
    textarea{resize:vertical}
    .choice{display:flex;align-items:center;gap:8px;font-weight:400;margin-top:6px;cursor:pointer}
    .choice input{width:auto;margin:0}
    .rating{font-size:1.8rem;letter-spacing:4px;color:#F6923E;margin-top:4px}
    .nps{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
    .nps span{width:38px;height:38px;border:1.5px solid #C7EAFB;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:.9rem;cursor:pointer}
    .section-break{margin:32px 0 20px}
    .section-break hr{border:none;border-top:1.5px solid #C7EAFB;margin-bottom:16px}
    .section-break h3{font-size:1.1rem;font-weight:700}
    .statement{color:#555;line-height:1.6;margin-bottom:8px}
    button[type=submit]{margin-top:32px;background:#052139;color:#fff;border:none;padding:14px 32px;border-radius:12px;font-size:1rem;font-weight:600;cursor:pointer;font-family:inherit}
    button[type=submit]:hover{background:#0a3a5c}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${esc(form.title)}</h1>
    ${form.description ? `<p class="form-desc">${esc(form.description)}</p>` : ''}
    <form>
      ${sortedFields.map(renderField).join('\n      ')}
      <button type="submit">Envoyer</button>
    </form>
  </div>
</body>
</html>`;
}

// ============================================================================
// ErrorBoundary par widget — isole les crashs de rendu de chaque graphique
// ============================================================================
interface ChartErrorBoundaryProps {
  children: ReactNode;
  fieldLabel: string;
}
interface ChartErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

class ChartErrorBoundary extends Component<ChartErrorBoundaryProps, ChartErrorBoundaryState> {
  constructor(props: ChartErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): ChartErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error) {
    console.error(`[ChartWidget] Erreur de rendu pour "${this.props.fieldLabel}":`, error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-5 min-h-[120px] flex flex-col justify-center gap-2">
          <p className="text-xs font-semibold text-danger">
            Erreur de rendu — {this.props.fieldLabel}
          </p>
          <p className="text-[11px] font-mono text-text-tertiary break-all">
            {this.state.errorMessage}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================================
// Onglet Vue d'ensemble — Graphiques automatiques et interactifs
// ============================================================================
interface FormInsightsTabProps {
  form: Form;
  submissions: any[];
  loading: boolean;
}

export function FormInsightsTab({ form, submissions, loading }: FormInsightsTabProps) {
  const [localForm, setLocalForm] = useState<Form>(form);

  useEffect(() => {
    if (!form) return;
    setLocalForm(prev => {
      if (prev.id !== form.id) return form;
      if (prev.updated_at === form.updated_at) return prev;
      return form;
    });
  }, [form]);

  const dashboardConfig = localForm.theme.dashboard_config ?? {};
  const chartOrder = dashboardConfig.chart_order ?? [];
  const deletedCharts = dashboardConfig.deleted_charts ?? [];
  const chartTitles = dashboardConfig.chart_titles ?? {};
  const chartMatrixTypes = dashboardConfig.chart_matrix_types ?? {};

  // Calcule les statistiques du score si activé
  const scoreStats = useMemo(() => {
    if (!localForm.scoring_enabled || submissions.length === 0) return null;

    let totalPercentage = 0;
    let totalScoreSum = 0;
    let maxScoreSum = 0;
    let scoredCount = 0;

    const levels = localForm.theme.score_levels && localForm.theme.score_levels.length > 0
      ? localForm.theme.score_levels
      : DEFAULT_SCORE_LEVELS;

    const distribution = levels.map(level => ({
      ...level,
      count: 0
    }));

    submissions.forEach(sub => {
      const result = calculateFormScore(localForm, sub.responses || {});
      if (result) {
        totalPercentage += result.percentage;
        totalScoreSum += result.totalScore;
        maxScoreSum += result.maxScore;
        scoredCount++;

        const sortedLevels = [...distribution].sort((a, b) => b.minPercent - a.minPercent);
        const matched = sortedLevels.find(l => result.percentage >= l.minPercent) || sortedLevels[sortedLevels.length - 1];
        if (matched) {
          matched.count++;
        }
      }
    });

    if (scoredCount === 0) return null;

    const avgPercentage = Math.round(totalPercentage / scoredCount);
    const avgScore = (totalScoreSum / scoredCount).toFixed(1);
    const avgMaxScore = (maxScoreSum / scoredCount).toFixed(1);

    const sortedLevels = [...levels].sort((a, b) => b.minPercent - a.minPercent);
    const matchedLevel = sortedLevels.find(l => avgPercentage >= l.minPercent) || sortedLevels[sortedLevels.length - 1];

    return {
      avgPercentage,
      avgScore,
      avgMaxScore,
      scoredCount,
      distribution,
      matchedLevel
    };
  }, [localForm, submissions]);

  const LEVEL_COLORS: Record<string, { text: string; bg: string; border: string; hex: string }> = {
    green: {
      text: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/20',
      border: 'border-emerald-200 dark:border-emerald-900/40',
      hex: '#10B981'
    },
    blue: {
      text: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-950/20',
      border: 'border-blue-200 dark:border-blue-900/40',
      hex: '#3B82F6'
    },
    orange: {
      text: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-950/20',
      border: 'border-amber-200 dark:border-amber-900/40',
      hex: '#F59E0B'
    },
    red: {
      text: 'text-rose-600 dark:text-rose-400',
      bg: 'bg-rose-50 dark:bg-rose-950/20',
      border: 'border-rose-200 dark:border-rose-900/40',
      hex: '#EF4444'
    }
  };

  // Filtrer et ordonner les champs à afficher
  const orderedFields = useMemo(() => {
    return getOrderedChartFields(localForm.fields ?? [], chartOrder, deletedCharts);
  }, [localForm.fields, chartOrder, deletedCharts]);

  // Mesure dynamique de la largeur du conteneur pour react-grid-layout v2
  const { width: gridContainerWidth, containerRef: gridContainerRef, mounted: gridMounted } = useContainerWidth();

  // Layout react-grid-layout — initialisé depuis chart_layout ou dérivé de chart_order
  const [gridLayout, setGridLayout] = useState<LayoutItem[]>(() =>
    buildInitialLayout(orderedFields, dashboardConfig.chart_layout)
  );

  // Sync quand des champs sont ajoutés ou supprimés (preserve les positions existantes)
  useEffect(() => {
    setGridLayout((prev: LayoutItem[]) => {
      const next: LayoutItem[] = orderedFields.map((field, index) => {
        const existing = prev.find((l: LayoutItem) => l.i === field.id);
        return existing ?? { i: field.id, x: index % 2, y: Infinity, w: 1, h: 4 };
      });
      const sameSet =
        next.length === prev.length && next.every((l: LayoutItem, i: number) => l.i === prev[i]?.i);
      return sameSet ? prev : next;
    });
  }, [orderedFields]);

  // Persiste le layout après fin d'un drag ou d'un resize (EventCallback reçoit Layout = readonly LayoutItem[])
  const handleSaveLayout = async (newLayout: Layout): Promise<void> => {
    const chartLayout: ChartLayoutItem[] = [...newLayout].map((item: LayoutItem) => ({
      field_id: item.i,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    }));

    const config = localForm.theme.dashboard_config ?? {};
    const updatedTheme = {
      ...localForm.theme,
      dashboard_config: { ...config, chart_layout: chartLayout },
    };

    setLocalForm(prev => ({ ...prev, theme: updatedTheme }));

    try {
      await updateForm(localForm.id, { theme: updatedTheme });
    } catch (error) {
      console.error('Failed to save chart layout:', error);
      toast.error('Erreur lors de la sauvegarde du layout');
    }
  };

  // Callback de changement de titre
  const handleTitleChange = async (fieldId: string, newTitle: string) => {
    const config = localForm.theme.dashboard_config ?? {};
    const titles = { ...(config.chart_titles ?? {}), [fieldId]: newTitle };
    const updatedTheme = {
      ...localForm.theme,
      dashboard_config: { ...config, chart_titles: titles }
    };
    
    // Mise à jour optimiste
    setLocalForm(prev => ({ ...prev, theme: updatedTheme }));
    
    try {
      await updateForm(localForm.id, { theme: updatedTheme });
      toast.success('Titre du graphique mis à jour');
    } catch (error) {
      console.error('Failed to update chart title:', error);
      toast.error('Erreur lors de la mise à jour du titre');
      setLocalForm(form);
    }
  };

  // Callback de suppression d'un widget du dashboard
  const handleDeleteWidget = async (fieldId: string) => {
    const config = localForm.theme.dashboard_config ?? {};
    const deleted = [...(config.deleted_charts ?? []), fieldId];
    const updatedTheme = {
      ...localForm.theme,
      dashboard_config: { ...config, deleted_charts: deleted }
    };

    setLocalForm(prev => ({ ...prev, theme: updatedTheme }));

    try {
      await updateForm(localForm.id, { theme: updatedTheme });
      toast.success('Graphique masqué du tableau de bord');
    } catch (error) {
      console.error('Failed to delete chart:', error);
      toast.error('Erreur lors du masquage du graphique');
      setLocalForm(form);
    }
  };

  // Callback de changement du type de rendu pour une matrice (heatmap ou barres)
  function handleExportPDF() {
    window.print();
  }

  function handleExportHTML() {
    const html = generateFormHTML(localForm);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${localForm.slug || localForm.id}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const handleMatrixTypeChange = async (fieldId: string, type: 'heatmap' | 'bar') => {
    const config = localForm.theme.dashboard_config ?? {};
    const matrixTypes = { ...(config.chart_matrix_types ?? {}), [fieldId]: type };
    const updatedTheme = {
      ...localForm.theme,
      dashboard_config: { ...config, chart_matrix_types: matrixTypes }
    };

    setLocalForm(prev => ({ ...prev, theme: updatedTheme }));

    try {
      await updateForm(localForm.id, { theme: updatedTheme });
    } catch (error) {
      console.error('Failed to update matrix rendering:', error);
      setLocalForm(form);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center text-sm text-text-tertiary">
        Chargement des graphiques...
      </div>
    );
  }

  if (submissions.length === 0) {
    const activeChartableCount = (localForm.fields ?? []).filter(
      f => !['section_break', 'statement', 'image', 'video', 'file'].includes(f.type)
    ).length;

    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-dashed border-border-strong bg-bg-surface p-10 text-center">
          <BarChart3 className="mx-auto h-10 w-10 text-text-tertiary" />
          <h3 className="mt-4 font-display text-xl">Pas encore de réponses à analyser</h3>
          <p className="papyrus-meta mx-auto mt-1 max-w-md text-sm">
            i. Quand les premières réponses arriveront, un graphique sera automatiquement
            généré pour chacun des {activeChartableCount} champ{activeChartableCount > 1 ? 's' : ''} mesurable{activeChartableCount > 1 ? 's' : ''} de ce formulaire.
          </p>
        </div>
      </div>
    );
  }

  // S'il n'y a aucun graphique à afficher car ils ont tous été masqués
  if (orderedFields.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-strong bg-bg-surface p-10 text-center">
        <BarChart3 className="mx-auto h-10 w-10 text-text-tertiary" />
        <h3 className="mt-4 font-display text-xl">Tableau de bord vide</h3>
        <p className="papyrus-meta mx-auto mt-1 max-w-md text-sm">
          Tous les graphiques ont été masqués. Réinitialisez la configuration du tableau de bord ou rajoutez des questions pour générer de nouveaux graphiques.
        </p>
        <button
          onClick={async () => {
            const updatedTheme = {
              ...localForm.theme,
              dashboard_config: {}
            };
            setLocalForm(prev => ({ ...prev, theme: updatedTheme }));
            await updateForm(localForm.id, { theme: updatedTheme });
            toast.success('Tableau de bord réinitialisé');
          }}
          className="mt-4 rounded-sm bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover transition"
        >
          Réinitialiser le tableau de bord
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Score de maturité */}
      {localForm.scoring_enabled && scoreStats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1 : score moyen */}
          <div className="rounded-xl border border-border bg-bg-surface p-6 flex items-center gap-4">
            <div className="rounded-full bg-accent/10 p-2.5 shrink-0">
              <Award className="h-6 w-6 text-accent" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-secondary">
                {localForm.theme.score_label || 'Score de maturité moyen'}
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-4xl font-bold text-text-primary">
                  {scoreStats.avgPercentage}%
                </span>
                <span className="text-xs font-mono text-text-tertiary">
                  ({scoreStats.avgScore} / {scoreStats.avgMaxScore} pts)
                </span>
              </div>
            </div>
          </div>

          {/* Card 2 : distribution par niveau */}
          <div className="rounded-xl border border-border bg-bg-surface p-6 flex flex-col min-h-[160px]">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-text-secondary" />
              <h3 className="font-display text-sm font-semibold text-text-primary">Distribution par niveau</h3>
            </div>
            <div className="w-full" style={{ height: 140 }}>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart
                  data={scoreStats.distribution}
                  layout="vertical"
                  margin={{ top: 4, right: 15, left: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border-weak)" />
                  <XAxis type="number" allowDecimals={false} stroke="var(--fg-tertiary)" fontSize={10} />
                  <YAxis dataKey="title" type="category" stroke="var(--fg-tertiary)" fontSize={10} width={100} />
                  <Tooltip
                    formatter={(value) => [`${value} répondant${Number(value) > 1 ? 's' : ''}`]}
                    contentStyle={{ fontSize: 11, backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={16}>
                    {scoreStats.distribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={LEVEL_COLORS[entry.color]?.hex || 'var(--accent)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <h2 className="font-display text-xl">
          {localForm.title}
          <span className="ml-2 text-base font-normal text-text-tertiary font-body">
            ({submissions.length} répondant{submissions.length > 1 ? 's' : ''})
          </span>
        </h2>
        <div className="flex items-center gap-1.5 print:hidden">
          <Button variant="ghost" onClick={handleExportHTML} className="h-8 gap-1.5 px-3 text-xs text-text-tertiary hover:text-text-primary">
            <Download className="h-3.5 w-3.5" />
            HTML
          </Button>
          <Button variant="ghost" onClick={handleExportPDF} className="h-8 gap-1.5 px-3 text-xs text-text-tertiary hover:text-text-primary">
            <Download className="h-3.5 w-3.5" />
            PDF
          </Button>
        </div>
      </div>

      <div ref={gridContainerRef as RefObject<HTMLDivElement>}>
        {gridMounted && (
          <GridLayout
            width={gridContainerWidth}
            layout={gridLayout}
            gridConfig={{ cols: 2, rowHeight: 80, margin: [24, 24] as readonly [number, number] }}
            dragConfig={{ handle: '.chart-drag-handle', threshold: 6 }}
            resizeConfig={{ handles: ['se'] as const }}
            compactor={verticalCompactor}
            onLayoutChange={(newLayout: Layout) => setGridLayout([...newLayout])}
            onDragStop={handleSaveLayout}
            onResizeStop={handleSaveLayout}
          >
            {orderedFields.map((field) => {
              const fieldTitle = chartTitles[field.id] || field.label.fr || 'Question sans titre';
              const matrixType = chartMatrixTypes[field.id] || 'heatmap';

              return (
                <div key={field.id} className="chart-widget-grid-item">
                  <ChartErrorBoundary fieldLabel={fieldTitle}>
                    <ChartWidget
                      field={field}
                      submissions={submissions}
                      title={fieldTitle}
                      theme={localForm.theme}
                      matrixType={matrixType}
                      onTitleChange={(newTitle: string) => handleTitleChange(field.id, newTitle)}
                      onDelete={() => handleDeleteWidget(field.id)}
                      onMatrixTypeChange={(type: 'heatmap' | 'bar') => handleMatrixTypeChange(field.id, type)}
                    />
                  </ChartErrorBoundary>
                </div>
              );
            })}
          </GridLayout>
        )}
      </div>
    </div>
  );
}

// ============================================================================
