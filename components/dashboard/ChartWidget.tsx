'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Trash2,
  GripVertical,
  Pencil,
  Grid,
  BarChart3,
  X
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import type { Field, FormTheme } from '@/types';
import { selectChartKind, preparePieData, type OptionCount } from '@/lib/chart-selector';
import { cn } from '@/lib/utils';

interface ChartWidgetProps {
  field: Field;
  submissions: any[];
  title: string;
  onTitleChange: (newTitle: string) => void;
  onDelete: () => void;
  isExportMode?: boolean;
  theme: FormTheme;
  matrixType: 'heatmap' | 'bar';
  onMatrixTypeChange: (type: 'heatmap' | 'bar') => void;
}


const PIE_COLORS = [
  '#052139',
  '#1E40AF',
  '#0D9488',
  '#D97706',
  '#7C3AED',
  '#DB2777',
  '#4B5563',
  '#059669',
  '#DC2626',
];

export function ChartWidget({
  field,
  submissions,
  title,
  onTitleChange,
  onDelete,
  isExportMode = false,
  theme,
  matrixType = 'heatmap',
  onMatrixTypeChange,
}: ChartWidgetProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(title);
  const [showAutresModal, setShowAutresModal] = useState(false);
  const [autresData, setAutresData] = useState<OptionCount[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setEditTitle(title);
  }, [title]);

  const kind = useMemo(() => {
    return selectChartKind(field, submissions.length);
  }, [field, submissions.length]);

  const accentColor = theme.accent || '#052139';

  // 1. Extraction et formatage des données selon le type de champ
  const chartData = useMemo(() => {
    if (submissions.length === 0) return [];

    switch (field.type) {
      case 'single_choice':
      case 'dropdown': {
        const counts: Record<string, number> = {};
        // Initialiser les options à 0
        field.options?.forEach(opt => {
          counts[opt.id] = 0;
        });

        submissions.forEach(sub => {
          const val = sub.responses?.[field.id];
          if (val) {
            counts[val] = (counts[val] || 0) + 1;
          }
        });

        const optionCounts = (field.options ?? []).map(opt => {
          const label = opt.label.fr || opt.label.en || opt.id;
          return {
            id: opt.id,
            label,
            count: counts[opt.id] || 0
          };
        });

        if (kind === 'pie') {
          return preparePieData(optionCounts, 5);
        }
        return optionCounts.sort((a, b) => b.count - a.count);
      }

      case 'multiple_choice': {
        const counts: Record<string, number> = {};
        field.options?.forEach(opt => {
          counts[opt.id] = 0;
        });

        submissions.forEach(sub => {
          const val = sub.responses?.[field.id];
          if (Array.isArray(val)) {
            val.forEach(v => {
              counts[v] = (counts[v] || 0) + 1;
            });
          } else if (typeof val === 'string') {
            // cas de repli si soumis en string séparée par virgules
            val.split(',').forEach(v => {
              const clean = v.trim();
              counts[clean] = (counts[clean] || 0) + 1;
            });
          }
        });

        return (field.options ?? []).map(opt => {
          const label = opt.label.fr || opt.label.en || opt.id;
          return {
            id: opt.id,
            label,
            count: counts[opt.id] || 0
          };
        }).sort((a, b) => b.count - a.count);
      }

      case 'rating':
      case 'nps': {
        const counts: Record<number, number> = {};
        const maxVal = field.type === 'nps' ? (field.validation?.max ?? 10) : (field.validation?.max ?? 5);
        const minVal = field.type === 'nps' ? (field.validation?.min ?? 0) : 1;

        for (let i = minVal; i <= maxVal; i++) {
          counts[i] = 0;
        }

        submissions.forEach(sub => {
          const val = sub.responses?.[field.id];
          const num = Number(val);
          if (!isNaN(num) && num >= minVal && num <= maxVal) {
            counts[num] = (counts[num] || 0) + 1;
          }
        });

        const list = [];
        for (let i = minVal; i <= maxVal; i++) {
          list.push({
            label: String(i),
            count: counts[i] || 0
          });
        }
        return list;
      }

      case 'number': {
        const counts: Record<string, number> = {};
        submissions.forEach(sub => {
          const val = sub.responses?.[field.id];
          const num = Number(val);
          if (val !== undefined && val !== null && val !== '' && !isNaN(num)) {
            const key = String(num);
            counts[key] = (counts[key] || 0) + 1;
          }
        });
        return Object.entries(counts)
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => Number(a.label) - Number(b.label));
      }

      case 'date': {
        const counts: Record<string, number> = {};
        submissions.forEach(sub => {
          const val = sub.responses?.[field.id];
          if (val) {
            // Formater la date en jj/mm/aaaa
            try {
              const d = new Date(val);
              if (!isNaN(d.getTime())) {
                const formatted = d.toLocaleDateString('fr-FR');
                counts[formatted] = (counts[formatted] || 0) + 1;
              }
            } catch {}
          }
        });

        return Object.entries(counts)
          .map(([date, count]) => ({ label: date, count }))
          .sort((a, b) => {
            // Tri chronologique
            const [da, ma, ya] = a.label.split('/');
            const [db, mb, yb] = b.label.split('/');
            return new Date(`${ya}-${ma}-${da}`).getTime() - new Date(`${yb}-${mb}-${db}`).getTime();
          });
      }

      case 'matrix': {
        // Préparer les données pour les deux modes (bar et heatmap)
        const rows = field.rows ?? [];
        const cols = field.options ?? [];
        
        // Structure de comptage : { [rowId]: { [colId]: count } }
        const counts: Record<string, Record<string, number>> = {};
        rows.forEach(r => {
          counts[r.id] = {};
          cols.forEach(c => {
            counts[r.id][c.id] = 0;
          });
        });

        submissions.forEach(sub => {
          const val = sub.responses?.[field.id];
          if (val && typeof val === 'object') {
            Object.entries(val).forEach(([rowId, colId]) => {
              if (counts[rowId]) {
                if (Array.isArray(colId)) {
                  colId.forEach(cid => {
                    counts[rowId][cid] = (counts[rowId][cid] || 0) + 1;
                  });
                } else if (typeof colId === 'string' && counts[rowId][colId] !== undefined) {
                  counts[rowId][colId] = (counts[rowId][colId] || 0) + 1;
                }
              }
            });
          }
        });

        return { rows, cols, counts };
      }

      default:
        // Texte libre — filtre strict : seules les strings et les numbers passent
        return submissions
          .map(sub => sub.responses?.[field.id])
          .filter((val): val is string | number => typeof val === 'string' || typeof val === 'number');
    }
  }, [field, submissions, kind]);

  // Moyenne pour rating/nps
  const averageScore = useMemo(() => {
    if (field.type !== 'rating' && field.type !== 'nps') return null;
    let sum = 0;
    let count = 0;
    submissions.forEach(sub => {
      const val = sub.responses?.[field.id];
      const num = Number(val);
      if (!isNaN(num) && val !== undefined && val !== null && val !== '') {
        sum += num;
        count++;
      }
    });
    return count > 0 ? (sum / count).toFixed(1) : null;
  }, [field, submissions]);

  // Calcul NPS (promoteurs/passifs/détracteurs) si 0-10
  const npsData = useMemo(() => {
    if (field.type !== 'nps') return null;
    const min = field.validation?.min ?? 0;
    const max = field.validation?.max ?? 10;

    if (min !== 0 || max !== 10) return null;

    let promoters = 0;
    let passives = 0;
    let detractors = 0;
    let total = 0;

    submissions.forEach(sub => {
      const val = sub.responses?.[field.id];
      const num = Number(val);
      if (val !== undefined && val !== null && val !== '' && !isNaN(num)) {
        total++;
        if (num >= 9) promoters++;
        else if (num >= 7) passives++;
        else detractors++;
      }
    });

    if (total === 0) {
      return {
        promoters: 0,
        passives: 0,
        detractors: 0,
        total: 0,
        npsScore: 0,
        pctPromoters: 0,
        pctPassives: 0,
        pctDetractors: 0
      };
    }

    const pctPromoters = (promoters / total) * 100;
    const pctPassives = (passives / total) * 100;
    const pctDetractors = (detractors / total) * 100;
    const npsScore = Math.round(pctPromoters - pctDetractors);

    return {
      promoters,
      passives,
      detractors,
      total,
      npsScore,
      pctPromoters,
      pctPassives,
      pctDetractors
    };
  }, [field, submissions]);

  // Sauvegarde du titre modifié
  const saveTitle = () => {
    setIsEditing(false);
    if (editTitle.trim() && editTitle.trim() !== title) {
      onTitleChange(editTitle.trim());
    } else {
      setEditTitle(title);
    }
  };

  // Rendu de la légende personnalisée pour le camembert
  const renderCustomLegend = (data: OptionCount[]) => {
    return (
      <div className="flex flex-col justify-center space-y-1.5 pl-4 max-h-[220px] overflow-y-auto w-full">
        {data.map((entry, index) => {
          const color = PIE_COLORS[index % PIE_COLORS.length];
          const isAutres = entry.label === 'Autres';

          return (
            <div
              key={entry.label}
              className={cn(
                "flex items-center justify-between text-xs text-text-secondary select-none",
                isAutres && "cursor-pointer hover:bg-bg-elevated p-1 rounded-sm font-semibold text-accent"
              )}
              onClick={() => {
                if (isAutres && entry._grouped) {
                  setAutresData(entry._grouped);
                  setShowAutresModal(true);
                }
              }}
            >
              <div className="flex items-center gap-2 truncate">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="truncate" title={entry.label}>{entry.label}{isAutres && ' 🔍'}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderChart = () => {
    if (submissions.length === 0) {
      return (
        <div className="flex h-[200px] items-center justify-center text-sm italic text-text-tertiary">
          Aucune réponse pour le moment
        </div>
      );
    }

    switch (kind) {
      case 'pie': {
        const data = chartData as OptionCount[];
        const chartHeight = Math.max(dimensions.height > 0 ? dimensions.height : 220, 220);
        return (
          <div
            className="flex flex-col md:flex-row items-center justify-between w-full gap-4"
            style={{ height: chartHeight, minHeight: 220 }}
          >
            <div className="w-full md:w-[55%] h-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius="70%"
                    labelLine={false}
                    label={(props) => {
                      // Recharts 3 type ces propriétes comme optionnelles, et
                      // les rayons comme `number | string`. On les normalise
                      // avant tout calcul : sinon `undefined` se propage
                      // silencieusement dans la trigonometrie et l'etiquette
                      // atterrit en NaN.
                      const percent = Number(props.percent ?? 0);
                      if (percent < 0.05) return null;
                      const cx = Number(props.cx ?? 0);
                      const cy = Number(props.cy ?? 0);
                      const midAngle = Number(props.midAngle ?? 0);
                      const innerRadius = Number(props.innerRadius ?? 0);
                      const outerRadius = Number(props.outerRadius ?? 0);
                      const RADIAN = Math.PI / 180;
                      const radius = innerRadius + (outerRadius - innerRadius) * 0.6;
                      const x = cx + radius * Math.cos(-midAngle * RADIAN);
                      const y = cy + radius * Math.sin(-midAngle * RADIAN);
                      return (
                        <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" className="text-[9px] font-bold pointer-events-none">
                          <tspan x={x}>{`${Math.round(percent * 100)}%`}</tspan>
                        </text>
                      );
                    }}
                    onClick={(payload) => {
                      // `label` et `_grouped` viennent de nos propres donnees :
                      // Recharts les recopie dans le point mais ne les connait
                      // pas dans son typage.
                      const point = payload as unknown as OptionCount | undefined;
                      if (point?.label === 'Autres' && point._grouped) {
                        setAutresData(point._grouped);
                        setShowAutresModal(true);
                      }
                    }}
                  >
                    {data.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={PIE_COLORS[index % PIE_COLORS.length]} 
                        className={entry.label === 'Autres' ? 'cursor-pointer hover:opacity-80' : ''}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value, name) => [`${value} réponses`, name]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-full md:w-[45%] mt-4 md:mt-0 border-t md:border-t-0 md:border-l border-border pt-3 md:pt-0">
              {renderCustomLegend(data)}
            </div>
          </div>
        );
      }
 
      case 'bar_horizontal': {
        const rawData = chartData as { label: string; count: number }[];
        const data = rawData.filter(d => d.count > 0);
        const hiddenCount = rawData.length - data.length;

        if (data.length === 0) {
          return (
            <div className="flex h-[200px] items-center justify-center text-sm italic text-text-tertiary">
              Aucune option sélectionnée pour cette question
            </div>
          );
        }

        const maxLength = Math.max(...data.map(d => d.label.length), 0);
        const availableWidth = dimensions.width > 0 ? dimensions.width : 400;
        const yAxisWidth = Math.min(Math.floor(availableWidth * 0.45), Math.max(80, maxLength * 7.5));
        const innerHeight = data.length > 5 ? data.length * 38 + 50 : 220;

        const CustomYAxisTick = (props: any) => {
          const { x, y, payload } = props;
          const tickText = payload.value || '';
          const limit = Math.max(5, Math.floor(yAxisWidth / 7.5));
          const truncated = tickText.length > limit ? tickText.substring(0, limit - 3) + '...' : tickText;
          return (
            <g transform={`translate(${x},${y})`}>
              <text
                x={-10}
                y={4}
                textAnchor="end"
                fill="var(--fg-tertiary)"
                fontSize={11}
                className="cursor-help"
              >
                <title>{tickText}</title>
                {truncated}
              </text>
            </g>
          );
        };

        return (
          <div className="flex flex-col h-full w-full min-h-0">
            <div className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden pr-2 scrollbar-thin">
              <div style={{ height: innerHeight }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data}
                    layout="vertical"
                    margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} stroke="var(--fg-tertiary)" fontSize={11} />
                    <YAxis 
                      dataKey="label" 
                      type="category" 
                      width={yAxisWidth} 
                      stroke="var(--fg-tertiary)" 
                      fontSize={11} 
                      tick={<CustomYAxisTick />}
                    />
                    <Tooltip formatter={(value) => [`${value} réponses`]} />
                    <Bar dataKey="count" fill={accentColor} radius={[0, 4, 4, 0]} maxBarSize={30} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {hiddenCount > 0 && (
              <div className="mt-2 text-left text-xs text-text-tertiary italic select-none">
                *{hiddenCount} autre{hiddenCount > 1 ? 's' : ''} option{hiddenCount > 1 ? 's' : ''} non sélectionnée{hiddenCount > 1 ? 's' : ''}
              </div>
            )}
          </div>
        );
      }

      case 'bar': {
        const data = chartData as { label: string; count: number }[];
        return (
          <div className="h-full min-h-0 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke="var(--fg-tertiary)" fontSize={11} />
                <YAxis allowDecimals={false} stroke="var(--fg-tertiary)" fontSize={11} />
                <Tooltip formatter={(value) => [`${value} réponses`]} />
                <Bar dataKey="count" fill={accentColor} radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      }

      case 'histogram': {
        const data = chartData as { label: string; count: number }[];
        return (
          <div className="h-full min-h-0 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke="var(--fg-tertiary)" fontSize={10} />
                <YAxis allowDecimals={false} stroke="var(--fg-tertiary)" fontSize={11} />
                <Tooltip formatter={(value) => [`${value} réponses`]} />
                <Bar dataKey="count" fill={accentColor} radius={[4, 4, 0, 0]} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      }

      case 'heatmap': {
        const { rows, cols, counts } = chartData as {
          rows: any[];
          cols: any[];
          counts: Record<string, Record<string, number>>;
        };

        if (matrixType === 'bar') {
          // Mode barres groupées
          const groupedData = rows.map(r => {
            const item: Record<string, any> = { name: r.label.fr || r.label.en || r.id };
            cols.forEach(c => {
              const colLabel = c.label.fr || c.label.en || c.id;
              item[colLabel] = counts[r.id][c.id] || 0;
            });
            return item;
          });

          return (
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={groupedData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--fg-tertiary)" fontSize={11} />
                  <YAxis allowDecimals={false} stroke="var(--fg-tertiary)" fontSize={11} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {cols.map((c, i) => {
                    const colLabel = c.label.fr || c.label.en || c.id;
                    return (
                      <Bar
                        key={c.id}
                        dataKey={colLabel}
                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                        radius={[2, 2, 0, 0]}
                      />
                    );
                  })}
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        }

        // Mode Heatmap CSS (par défaut)
        // Trouver la valeur maximale pour l'opacité
        let maxCount = 0;
        rows.forEach(r => {
          cols.forEach(c => {
            const count = counts[r.id][c.id] || 0;
            if (count > maxCount) maxCount = count;
          });
        });

        return (
          <div className="w-full overflow-x-auto select-none pt-2">
            <div className="min-w-[500px] border border-border rounded-lg overflow-hidden bg-bg-base/30">
              {/* En-tête des colonnes */}
              <div 
                className="grid border-b border-border bg-bg-elevated/40"
                style={{ gridTemplateColumns: `140px repeat(${cols.length}, minmax(0, 1fr))` }}
              >
                <div className="p-2.5 text-xs font-semibold text-text-tertiary">Critères</div>
                {cols.map(c => (
                  <div key={c.id} className="p-2.5 text-xs font-semibold text-text-secondary text-center truncate" title={c.label.fr || c.id}>
                    {c.label.fr || c.id}
                  </div>
                ))}
              </div>

              {/* Lignes de la grille */}
              <div className="divide-y divide-border">
                {rows.map(r => (
                  <div 
                    key={r.id} 
                    className="grid items-center hover:bg-bg-elevated/20 transition-colors"
                    style={{ gridTemplateColumns: `140px repeat(${cols.length}, minmax(0, 1fr))` }}
                  >
                    <div className="p-2.5 text-xs font-medium text-text-primary truncate" title={r.label.fr || r.id}>
                      {r.label.fr || r.id}
                    </div>
                    {cols.map(c => {
                      const count = counts[r.id][c.id] || 0;
                      const opacity = maxCount > 0 ? (count / maxCount) : 0;
                      
                      return (
                        <div 
                          key={c.id} 
                          className="relative group/cell h-11 flex items-center justify-center border-l border-border transition-all duration-200"
                          style={{ 
                            backgroundColor: count > 0 ? `rgba(${hexToRgb(accentColor)}, ${Math.max(0.08, opacity * 0.85)})` : 'transparent',
                          }}
                        >
                          <span 
                            className={cn(
                              "text-xs font-mono font-semibold",
                              opacity > 0.4 ? "text-white drop-shadow-sm" : "text-text-primary"
                            )}
                          >
                            {count}
                          </span>
                          
                          {/* Tooltip personnalisé en pur CSS */}
                          <div className="absolute z-20 bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover/cell:block bg-bg-surface border border-border shadow-lg rounded-sm px-2.5 py-1.5 text-[11px] whitespace-nowrap text-text-primary pointer-events-none transition-all">
                            <span className="font-semibold">{r.label.fr || r.id}</span>
                            <span className="mx-1 text-text-tertiary">›</span>
                            <span>{c.label.fr || c.id}</span>
                            <div className="border-t border-border mt-1 pt-0.5 font-semibold text-accent">
                              {count} réponse{count > 1 ? 's' : ''} ({submissions.length > 0 ? ((count / submissions.length) * 100).toFixed(0) : 0}%)
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      }

      case 'list': {
        const data = chartData as string[];
        return (
          <div className="h-full min-h-0 overflow-y-auto border border-border rounded-lg bg-bg-base/20 divide-y divide-border scrollbar-thin">
            {data.length === 0 ? (
              <div className="p-4 text-center text-xs text-text-tertiary italic">Aucun texte soumis</div>
            ) : (
              data.map((text, i) => (
                <div key={i} className="p-3 text-xs text-text-secondary hover:bg-bg-elevated/10 transition-colors wrap-break-word">
                  {text}
                </div>
              ))
            )}
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div
      style={{
        backgroundColor: theme.field_bg_color,
      }}
      className={cn(
        'group/widget relative rounded-lg border p-5 transition flex flex-col justify-between h-full min-h-[300px] overflow-hidden',
        theme.field_bg_color ? '' : 'bg-bg-surface',
        'border-border hover:border-border-strong',
      )}
    >
      {/* Header du Widget */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex flex-1 items-center gap-1.5 min-w-0">
          {!isExportMode && (
            <button
              type="button"
              className="chart-drag-handle cursor-grab rounded-sm p-1 text-text-tertiary opacity-0 group-hover/widget:opacity-100 transition hover:bg-bg-elevated hover:text-text-primary active:cursor-grabbing shrink-0"
              title="Glisser pour réordonner"
              aria-label="Glisser pour réordonner"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          {isEditing ? (
            <input
              autoFocus
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle();
                if (e.key === 'Escape') {
                  setIsEditing(false);
                  setEditTitle(title);
                }
              }}
              className="flex-1 rounded-sm border border-accent bg-bg-base px-2 py-0.5 text-base font-semibold focus:outline-hidden"
            />
          ) : (
            <div 
              onClick={() => !isExportMode && setIsEditing(true)} 
              className={cn(
                "flex items-center gap-2 group/title cursor-pointer truncate max-w-full",
                !isExportMode && "hover:bg-bg-elevated/40 px-1 rounded-sm transition-colors"
              )}
            >
              <h4 className="text-base font-semibold text-text-primary truncate" title={title}>
                {title}
              </h4>
              {!isExportMode && (
                <Pencil className="h-3 w-3 shrink-0 text-text-tertiary opacity-0 group-hover/title:opacity-100 transition-opacity" />
              )}
            </div>
          )}
        </div>

        {/* Boutons d'action en haut à droite */}
        {!isExportMode && (
          <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover/widget:opacity-100 transition-opacity ml-2">
            {/* Toggle spécial pour Matrix */}
            {field.type === 'matrix' && onMatrixTypeChange && (
              <div className="flex border border-border rounded-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => onMatrixTypeChange('heatmap')}
                  className={cn(
                    "p-1.5 transition-colors",
                    matrixType === 'heatmap' ? "bg-accent/15 text-accent font-semibold" : "bg-bg-surface text-text-tertiary hover:bg-bg-elevated"
                  )}
                  title="Afficher comme Heatmap"
                >
                  <Grid className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onMatrixTypeChange('bar')}
                  className={cn(
                    "p-1.5 transition-colors",
                    matrixType === 'bar' ? "bg-accent/15 text-accent font-semibold" : "bg-bg-surface text-text-tertiary hover:bg-bg-elevated"
                  )}
                  title="Afficher comme Graphique de barres"
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            
            {/* Bouton de suppression */}
            <button
              type="button"
              onClick={onDelete}
              className="rounded-sm p-1.5 text-text-tertiary transition hover:bg-danger/10 hover:text-danger"
              title="Supprimer ce graphique du tableau de bord"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Affichage de la moyenne pour rating et NPS */}
      {averageScore && (
        <div className="mb-4 flex flex-col md:flex-row gap-4 items-start md:items-center w-full">
          <div className="flex items-baseline gap-1 bg-accent/5 rounded-lg px-3 py-2 border border-accent/10 shrink-0">
            <span className="text-xs text-text-secondary font-medium">Moyenne :</span>
            <span className="text-xl font-bold text-accent font-mono">{averageScore}</span>
            <span className="text-xs text-text-tertiary font-mono">
              / {field.type === 'nps' ? (field.validation?.max ?? 10) : (field.validation?.max ?? 5)}
            </span>
          </div>

          {npsData && npsData.total > 0 && (
            <>
              <div className="flex items-baseline gap-1 bg-mooove-cyan/5 rounded-lg px-3 py-2 border border-mooove-cyan/10 shrink-0">
                <span className="text-xs text-text-secondary font-medium">Score NPS :</span>
                <span className={cn(
                  "text-xl font-bold font-mono",
                  npsData.npsScore > 0 ? "text-green-600 dark:text-green-400" : npsData.npsScore < 0 ? "text-red-600 dark:text-red-400" : "text-text-primary"
                )}>
                  {npsData.npsScore > 0 ? `+${npsData.npsScore}` : npsData.npsScore}
                </span>
              </div>

              {/* Barre de progression des segments NPS */}
              <div className="flex-1 flex gap-2 w-full text-[10px] items-center">
                <div className="flex flex-col flex-1 gap-1 min-w-[200px]">
                  <div className="flex justify-between text-[10px] text-text-secondary select-none font-sans">
                    <span>Promoteurs (9-10) : <span className="font-semibold text-green-600">{npsData.pctPromoters.toFixed(0)}%</span></span>
                    <span>Passifs (7-8) : <span className="font-semibold text-amber-600">{npsData.pctPassives.toFixed(0)}%</span></span>
                    <span>Détracteurs (0-6) : <span className="font-semibold text-red-600">{npsData.pctDetractors.toFixed(0)}%</span></span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-bg-base border border-border flex overflow-hidden">
                    <div style={{ width: `${npsData.pctPromoters}%` }} className="bg-green-500 h-full" title={`Promoteurs: ${npsData.pctPromoters.toFixed(1)}%`} />
                    <div style={{ width: `${npsData.pctPassives}%` }} className="bg-amber-400 h-full" title={`Passifs: ${npsData.pctPassives.toFixed(1)}%`} />
                    <div style={{ width: `${npsData.pctDetractors}%` }} className="bg-red-500 h-full" title={`Détracteurs: ${npsData.pctDetractors.toFixed(1)}%`} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Zone du Graphique */}
      <div ref={containerRef} className="grow flex-1 w-full flex items-stretch justify-center min-h-[220px] relative">
        {renderChart()}
      </div>

      {/* Modal / Liste dépliée pour le slice "Autres" */}
      {showAutresModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-bg-surface shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border bg-bg-elevated/20 px-4 py-3">
              <h5 className="font-semibold text-text-primary text-sm flex items-center gap-1.5">
                <span>Détail de la catégorie « Autres »</span>
              </h5>
              <button 
                onClick={() => setShowAutresModal(false)}
                className="rounded-sm p-1 text-text-tertiary hover:bg-bg-elevated hover:text-text-primary transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 max-h-[300px] overflow-y-auto divide-y divide-border scrollbar-thin">
              {autresData.map((opt, i) => (
                <div key={i} className="flex justify-between py-2 text-xs text-text-secondary">
                  <span className="truncate font-medium pr-4">{opt.label}</span>
                  <span className="font-mono text-text-tertiary shrink-0">
                    {opt.count} réponse{opt.count > 1 ? 's' : ''}
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-border bg-bg-elevated/10 px-4 py-2 text-right">
              <button
                onClick={() => setShowAutresModal(false)}
                className="rounded-sm bg-accent px-3 py-1 text-xs font-semibold text-white hover:bg-accent-hover transition"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Helper simple pour transformer une couleur hex (#052139) en triplet RGB pour l'opacité CSS */
function hexToRgb(hex: string): string {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map(char => char + char).join('');
  }
  const num = parseInt(cleanHex, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `${r}, ${g}, ${b}`;
}
