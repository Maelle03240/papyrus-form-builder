'use client';

import { useMemo } from 'react';
import type { Form, Field, LogicRule } from '@/types';
import { cn } from '@/lib/utils';
import {
  GitFork,
  HelpCircle,
  Type,
  AlignLeft,
  Mail,
  Phone,
  Binary,
  Globe,
  CheckCircle,
  CheckSquare,
  List,
  Star,
  BarChart,
  Calendar,
  FileUp,
  Grid,
  Volume2
} from 'lucide-react';

interface Props {
  form: Form;
}

interface RenderNode {
  id: string;
  type: 'field' | 'decision' | 'end';
  label: string;
  subtitle?: string;
  isConditional?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  lines?: string[];
}

interface RenderEdge {
  id: string;
  fromId: string;
  toId: string;
  path: string;
  isDefault: boolean;
  isConditionalSource?: boolean;
  label?: string;
  labelType?: 'oui' | 'sinon';
  labelX?: number;
  labelY?: number;
}

function getFieldTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    short_text: 'Réponse courte',
    long_text: 'Réponse longue',
    email: 'Adresse e-mail',
    phone: 'Téléphone',
    number: 'Nombre',
    url: 'Lien site web',
    single_choice: 'Choix unique',
    multiple_choice: 'Choix multiple',
    dropdown: 'Liste déroulante',
    rating: 'Évaluation',
    nps: 'Échelle de notation',
    date: 'Date',
    file: 'Fichier / Média',
    matrix: 'Matrice',
    statement: 'Message / Note',
  };
  return labels[type] || type;
}

function getFieldLucideIcon(type: string) {
  switch (type) {
    case 'short_text': return Type;
    case 'long_text': return AlignLeft;
    case 'email': return Mail;
    case 'phone': return Phone;
    case 'number': return Binary;
    case 'url': return Globe;
    case 'single_choice': return CheckCircle;
    case 'multiple_choice': return CheckSquare;
    case 'dropdown': return List;
    case 'rating': return Star;
    case 'nps': return BarChart;
    case 'date': return Calendar;
    case 'file': return FileUp;
    case 'matrix': return Grid;
    case 'statement': return Volume2;
    default: return HelpCircle;
  }
}


function getDecisionLines(rule: LogicRule, fields: Field[]): string[] {
  if (!rule.conditions || rule.conditions.length === 0) {
    return ['Si rempli ?'];
  }

  const condTexts = rule.conditions.map(c => {
    const sourceField = fields.find(f => f.id === c.source_field_id);
    let valText = c.value;
    if (sourceField && sourceField.options) {
      const opt = sourceField.options.find(o => o.id === c.value);
      if (opt && opt.label?.fr) {
        valText = opt.label.fr;
      }
    }

    let opSymbol = '';
    switch (c.operator) {
      case 'equals': opSymbol = '='; break;
      case 'not_equals': opSymbol = '≠'; break;
      case 'contains': return `contient "${valText}"`;
      case 'not_contains': return `ne contient pas "${valText}"`;
      case 'greater_than': opSymbol = '>'; break;
      case 'less_than': opSymbol = '<'; break;
      default: opSymbol = c.operator;
    }
    return `${opSymbol} "${valText}"`;
  });

  const formattedConds = condTexts.map(ct => `Réponse ${ct}`);

  if (formattedConds.length === 1) {
    return [`${formattedConds[0]} ?`];
  }

  const opText = rule.conditions_operator === 'OR' ? '— OU —' : '— ET —';
  const lines: string[] = [];
  formattedConds.forEach((cond, index) => {
    if (index > 0) {
      lines.push(opText);
    }
    if (index === formattedConds.length - 1) {
      lines.push(`${cond} ?`);
    } else {
      lines.push(cond);
    }
  });
  return lines;
}



export function FormFlowView({ form }: Props) {
  const fields = useMemo(() => {
    return (form.fields || [])
      .sort((a, b) => a.field_order - b.field_order);
  }, [form.fields]);

  const rules = form.logic_rules || [];
  const hasRules = rules.length > 0;

  const layout = useMemo(() => {
    if (fields.length === 0) {
      return { nodes: [], edges: [], width: 800, height: 400, minX: 0, maxX: 800 };
    }

    // Paramètres graphiques premium
    const nodeW = 240;
    const nodeH = 72;
    const endW = 160;
    const endH = 40;
    const colW = 340;
    const rowH = 240; // Spacing augmenté pour loger les losanges et les lignes orthogonales
    const centerX = 450;
    const paddingY = 60;

    const nodes: RenderNode[] = [];
    const edges: RenderEdge[] = [];

    // 1. Identifier les champs conditionnels (ceux affichés via show_field)
    const conditionalFields = new Set<string>();
    rules.forEach(r => {
      if (r.action_type === 'show_field' && r.target_field_id) {
        conditionalFields.add(r.target_field_id);
      }
    });

    // 2. Assigner des colonnes de façon récursive
    const colMap: Record<string, number> = {};
    fields.forEach(f => {
      if (!conditionalFields.has(f.id)) {
        colMap[f.id] = 0;
      }
    });

    const assignColumns = (fieldId: string, currentCol: number) => {
      const childRules = rules.filter(r =>
        r.action_type === 'show_field' &&
        r.target_field_id &&
        r.conditions?.some(c => c.source_field_id === fieldId)
      );

      childRules.forEach((r, index) => {
        const targetId = r.target_field_id!;
        if (colMap[targetId] === undefined) {
          const direction = index % 2 === 0 ? 1 : -1;
          const step = Math.floor(index / 2) + 1;
          const targetCol = currentCol + direction * step;
          colMap[targetId] = targetCol;
          assignColumns(targetId, targetCol);
        }
      });
    };

    fields.forEach(f => {
      if (!conditionalFields.has(f.id)) {
        assignColumns(f.id, 0);
      }
    });

    // Fallback pour tout champ non assigné
    fields.forEach(f => {
      if (colMap[f.id] === undefined) {
        colMap[f.id] = 0;
      }
    });

    // 3. Positionner les nœuds de champs
    fields.forEach((f, index) => {
      const col = colMap[f.id];
      const row = index;
      const x = centerX + col * colW - nodeW / 2;
      const y = paddingY + row * rowH;

      nodes.push({
        id: f.id,
        type: 'field',
        label: f.label.fr || 'Champ sans titre',
        subtitle: getFieldTypeLabel(f.type),
        isConditional: conditionalFields.has(f.id),
        x,
        y,
        w: nodeW,
        h: nodeH
      });
    });

    // 4. Positionner les nœuds de décision et créer les transitions logiques
    fields.forEach(f => {
      const fieldRules = rules.filter(r =>
        r.conditions?.some(c => c.source_field_id === f.id)
      ).sort((a, b) => a.rule_order - b.rule_order);

      if (fieldRules.length === 0) return;

      const fRow = fields.indexOf(f);
      const fCol = colMap[f.id];
      const K = fieldRules.length;

      fieldRules.forEach((rule, j) => {
        const decisionLines = getDecisionLines(rule, fields);
        const maxLineLen = Math.max(...decisionLines.map(l => l.length));
        const decisionW = Math.max(140, maxLineLen * 9.5);
        const decisionH = Math.max(56, decisionLines.length * 18 + 16);

        const decisionCol = fCol + (j - (K - 1) / 2) * 0.45;
        const x = centerX + decisionCol * colW - decisionW / 2;
        const y = paddingY + fRow * rowH + nodeH + 40;

        const decisionId = `decision-${rule.id}`;
        nodes.push({
          id: decisionId,
          type: 'decision',
          label: decisionLines.join(' '),
          lines: decisionLines,
          x,
          y,
          w: decisionW,
          h: decisionH
        });

        // Liaison : Champ source -> Décision
        edges.push({
          id: `edge-${f.id}-${decisionId}`,
          fromId: f.id,
          toId: decisionId,
          path: `M ${centerX + fCol * colW} ${paddingY + fRow * rowH + nodeH} V ${y}`,
          isDefault: false
        });

        // Liaison : Décision -> Cible (Branche "vraie" / oui)
        // Départ du sommet droit du losange : (startX, startY)
        const startX = x + decisionW;
        const startY = y + decisionH / 2;

        let endX = centerX;
        let endY = paddingY + fields.length * rowH;

        if (rule.action_type === 'end_form') {
          endX = centerX;
          endY = paddingY + fields.length * rowH;
        } else if (rule.target_field_id) {
          const target = fields.find(tf => tf.id === rule.target_field_id);
          if (target) {
            const tRow = fields.indexOf(target);
            const tCol = colMap[target.id];
            endX = centerX + tCol * colW;
            endY = paddingY + tRow * rowH;
          }
        }

        // Routing orthogonal pour la branche "vraie" : L-shape simple H -> V
        const truePath = `M ${startX} ${startY} H ${endX} V ${endY}`;

        edges.push({
          id: `edge-${decisionId}-${rule.action_type === 'end_form' ? 'end' : rule.target_field_id}`,
          fromId: decisionId,
          toId: rule.action_type === 'end_form' ? 'end_form' : rule.target_field_id!,
          path: truePath,
          isDefault: false,
          labelType: 'oui',
          labelX: startX + 20,
          labelY: startY
        });
      });
    });

    // 5. Nœud de fin
    const endX = centerX - endW / 2;
    const endY = paddingY + fields.length * rowH;
    nodes.push({
      id: 'end_form',
      type: 'end',
      label: 'Fin du formulaire',
      x: endX,
      y: endY,
      w: endW,
      h: endH
    });

    // 6. Transitions par défaut (séquentielles)
    fields.forEach((f, index) => {
      const hasUnconditionalEnd = rules.some(r =>
        r.action_type === 'end_form' &&
        (!r.conditions || r.conditions.length === 0) &&
        r.conditions?.some(c => c.source_field_id === f.id)
      );
      if (hasUnconditionalEnd) return;

      const nextMainField = fields.slice(index + 1).find(tf => !conditionalFields.has(tf.id));
      const targetId = nextMainField ? nextMainField.id : 'end_form';
      const targetRow = nextMainField ? fields.indexOf(nextMainField) : fields.length;
      const targetCol = nextMainField ? colMap[nextMainField.id] : 0;

      const fCol = colMap[f.id];
      const fRow = index;

      const fieldRules = rules.filter(r => r.conditions?.some(c => c.source_field_id === f.id)).sort((a, b) => a.rule_order - b.rule_order);
      const hasFieldRules = fieldRules.length > 0;

      let startX = centerX + fCol * colW;
      let startY = paddingY + fRow * rowH + nodeH;

      let labelX: number | undefined;
      let labelY: number | undefined;

      if (hasFieldRules) {
        // Le point de départ devient le bas du dernier losange de décision
        const lastRule = fieldRules[fieldRules.length - 1];
        const lastDecisionId = `decision-${lastRule.id}`;
        
        // Trouver le nœud de décision correspondant déjà inséré pour récupérer ses dimensions
        const decisionNode = nodes.find(n => n.id === lastDecisionId);
        if (decisionNode) {
          startX = decisionNode.x + decisionNode.w / 2;
          startY = decisionNode.y + decisionNode.h;
          
          labelX = startX;
          labelY = startY + 18;
        }
      }

      const endX = centerX + targetCol * colW;
      const endY = paddingY + targetRow * rowH;

      // Routing orthogonal : V court -> H -> V long si décalage, V direct si alignés
      let pathStr = '';
      if (endX === startX) {
        pathStr = `M ${startX} ${startY} V ${endY}`;
      } else {
        const midY = startY + 30;
        pathStr = `M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`;
      }

      const isCondSource = conditionalFields.has(f.id);

      edges.push({
        id: `default-${f.id}-${targetId}`,
        fromId: f.id,
        toId: targetId,
        path: pathStr,
        isDefault: true,
        isConditionalSource: isCondSource,
        labelType: (hasFieldRules && !isCondSource) ? 'sinon' : undefined,
        labelX: (hasFieldRules && !isCondSource) ? labelX : undefined,
        labelY: (hasFieldRules && !isCondSource) ? labelY : undefined
      });
    });

    // 7. Calculer les dimensions de la zone de dessin (symétrique)
    let minCol = 0;
    let maxCol = 0;
    Object.values(colMap).forEach(c => {
      if (c < minCol) minCol = c;
      if (c > maxCol) maxCol = c;
    });

    const maxAbsCol = Math.max(Math.abs(minCol), Math.abs(maxCol));
    const marginL = -maxAbsCol * colW - nodeW / 2 - 80;
    const marginR = maxAbsCol * colW + nodeW / 2 + 80;

    const leftX = centerX + marginL;
    const rightX = centerX + marginR;

    const width = rightX - leftX;
    const height = endY + endH + 100;

    return {
      nodes,
      edges,
      width,
      height,
      minX: leftX,
      maxX: rightX
    };
  }, [fields, rules]);

  if (fields.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-12 text-center bg-[#F8FAFC]">
        <GitFork className="h-12 w-12 text-slate-400 mb-3 stroke-[1.5]" />
        <p className="font-display text-lg text-slate-700 font-semibold">Aucun champ dans ce formulaire</p>
        <p className="text-sm text-slate-500 mt-1">Ajoutez des questions pour générer le flux.</p>
      </div>
    );
  }

  const accentColor = form.theme?.accent || '#3B82F6';

  return (
    <div className="relative w-full h-full flex flex-col bg-[#F8FAFC] overflow-hidden">
      {/* Note d'information logique si vide */}
      {!hasRules && (
        <div className="shrink-0 bg-white border-b border-slate-100 px-6 py-3.5 text-xs text-slate-500 italic font-medium flex items-center gap-2 shadow-xs relative z-10">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0 animate-pulse" />
          Aucune logique conditionnelle configurée. Affichage de la liste séquentielle par défaut.
        </div>
      )}

      {/* Container scrollable de l'arbre */}
      <div className="flex-1 overflow-auto p-12 flex items-start justify-center select-none">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="shrink-0"
        >
          {/* Définitions des filtres de drop-shadow et têtes de flèches */}
          <defs>
            <pattern id="dot-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1" fill="#E2E8F0" />
            </pattern>
            
            <marker
              id="arrow-accent"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={accentColor} />
            </marker>
            <marker
              id="arrow-default"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#94A3B8" />
            </marker>
            <marker
              id="arrow-amber"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#854F0B" />
            </marker>
          </defs>

          {/* 0. Grille de fond pro */}
          <rect width={layout.width} height={layout.height} fill="url(#dot-grid)" />

          {/* Décaler tout le repère de minX pour que tout commence à x=0 */}
          <g transform={`translate(${-layout.minX}, 0)`}>
            {/* 1. Rendu des lignes de transition */}
            {layout.edges.map(edge => {
              let strokeColor = '#94A3B8';
              let strokeWidth = 1.5;
              const isDashed = edge.isDefault && !edge.isConditionalSource;
              let markerId = 'arrow-default';

              if (edge.labelType === 'oui' || edge.isConditionalSource) {
                strokeColor = '#854F0B';
                strokeWidth = 2;
                markerId = 'arrow-amber';
              } else if (!edge.isDefault) {
                strokeColor = accentColor;
                strokeWidth = 1.5;
                markerId = 'arrow-accent';
              }

              return (
                <path
                  key={edge.id}
                  d={edge.path}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeDasharray={isDashed ? '5,5' : undefined}
                  markerEnd={`url(#${markerId})`}
                  className="transition-all duration-300"
                />
              );
            })}

            {/* 1b. Rendu des pastilles de labels d'arêtes */}
            {layout.edges.map(edge => {
              if (!edge.labelType || edge.labelX === undefined || edge.labelY === undefined) return null;

              if (edge.labelType === 'oui') {
                return (
                  <g key={`label-${edge.id}`} className="select-none pointer-events-none">
                    <rect
                      x={edge.labelX - 18}
                      y={edge.labelY - 9}
                      width={36}
                      height={18}
                      rx={9}
                      fill="#FAEEDA"
                      stroke="#EF9F27"
                      strokeWidth={1}
                    />
                    <text
                      x={edge.labelX}
                      y={edge.labelY}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="fill-[#854F0B] text-[9px] font-bold"
                    >
                      oui
                    </text>
                  </g>
                );
              }

              if (edge.labelType === 'sinon') {
                return (
                  <g key={`label-${edge.id}`} className="select-none pointer-events-none">
                    <rect
                      x={edge.labelX - 22}
                      y={edge.labelY - 9}
                      width={44}
                      height={18}
                      rx={9}
                      fill="#F1EFE8"
                      stroke="#CBD5E1"
                      strokeWidth={1}
                    />
                    <text
                      x={edge.labelX}
                      y={edge.labelY}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="fill-[#64748B] text-[9px] font-bold"
                    >
                      sinon
                    </text>
                  </g>
                );
              }

              return null;
            })}

            {/* 2. Rendu des nœuds avec foreignObject/SVG pour un design sublime */}
            {layout.nodes.map(node => {
              if (node.type === 'field') {
                const isConditional = node.isConditional;
                const f = fields.find(field => field.id === node.id);
                const IconComponent = f ? getFieldLucideIcon(f.type) : HelpCircle;

                return (
                  <foreignObject
                    key={node.id}
                    x={node.x}
                    y={node.y}
                    width={node.w}
                    height={node.h}
                    className="overflow-visible"
                  >
                    <div
                      className={cn(
                        "flex h-full w-full rounded-xl border bg-white shadow-xs transition-all duration-300 hover:-translate-y-1 hover:shadow-md",
                        isConditional
                          ? "border-orange-200 hover:border-orange-300 hover:shadow-orange-100/40"
                          : "border-slate-200/80 hover:border-slate-300 hover:shadow-slate-100/60"
                      )}
                    >
                      {/* Accent de couleur sur la gauche */}
                      <div
                        className={cn(
                          "w-1.5 h-full rounded-l-xl shrink-0",
                          isConditional ? "bg-orange-500" : "bg-blue-600"
                        )}
                        style={!isConditional ? { backgroundColor: accentColor } : undefined}
                      />
                      
                      {/* Contenu textuel et icône */}
                      <div className="flex-1 min-w-0 p-3 flex flex-col justify-between">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-slate-800 text-[12px] truncate leading-tight select-none">
                            {node.label}
                          </span>
                          <span className="shrink-0 p-1 bg-slate-50 rounded-sm text-slate-400">
                            <IconComponent size={12} className="stroke-2" />
                          </span>
                        </div>
                        
                        <div className="flex items-end justify-between gap-2 mt-1">
                          <span className="text-[10px] font-medium text-slate-400 truncate select-none">
                            {node.subtitle}
                          </span>
                          {isConditional && (
                            <span className="shrink-0 text-[8px] font-bold bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded-sm border border-orange-100 uppercase tracking-wider select-none">
                              Conditionnel
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </foreignObject>
                );
              }

              if (node.type === 'decision') {
                const points = `${node.x + node.w / 2},${node.y} ${node.x + node.w},${node.y + node.h / 2} ${node.x + node.w / 2},${node.y + node.h} ${node.x},${node.y + node.h / 2}`;
                const lines = node.lines || [node.label];
                
                return (
                  <g key={node.id} className="group cursor-default">
                    <polygon
                      points={points}
                      fill="#FAEEDA"
                      stroke="#EF9F27"
                      strokeWidth={1.5}
                      className="transition-all duration-300 group-hover:fill-[#FCEFD9] group-hover:stroke-[#E08F18]"
                    />
                    <text
                      x={node.x + node.w / 2}
                      textAnchor="middle"
                      className="fill-slate-800 text-[10px] font-bold select-none pointer-events-none tracking-wide"
                    >
                      {lines.map((line, idx) => {
                        const lineY = node.y + node.h / 2 + (idx - (lines.length - 1) / 2) * 14;
                        return (
                          <tspan
                            key={idx}
                            x={node.x + node.w / 2}
                            y={lineY}
                            dominantBaseline="central"
                          >
                            {line}
                          </tspan>
                        );
                      })}
                    </text>
                  </g>
                );
              }

              if (node.type === 'end') {
                return (
                  <foreignObject
                    key={node.id}
                    x={node.x}
                    y={node.y}
                    width={node.w}
                    height={node.h}
                    className="overflow-visible"
                  >
                    <div
                      className="flex items-center justify-center h-full w-full rounded-full shadow-xs border text-white font-semibold text-xs transition-all duration-300 hover:scale-[1.02] select-none"
                      style={{
                        background: `linear-gradient(135deg, ${accentColor} 0%, #0F172A 100%)`,
                        borderColor: accentColor
                      }}
                    >
                      {node.label}
                    </div>
                  </foreignObject>
                );
              }

              return null;
            })}
          </g>
        </svg>
      </div>

      {/* Légende en overlay fixe */}
      <div className="absolute bottom-6 left-6 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl p-4 shadow-xs z-10 flex flex-col gap-2.5 text-[11px] text-slate-600 max-w-[280px]">
        <span className="font-semibold text-slate-800 uppercase tracking-wider text-[9px]">Légende</span>
        
        <div className="flex items-center gap-3">
          <div className="w-5 h-3.5 rounded-sm bg-white border border-slate-200 border-l-[3px] shrink-0" style={{ borderLeftColor: accentColor }} />
          <span className="font-medium text-slate-700">Question standard</span>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="w-5 h-3.5 rounded-sm bg-white border border-orange-200 border-l-[3px] border-l-orange-500 shrink-0" />
          <span className="font-medium text-slate-700">Question conditionnelle</span>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 flex items-center justify-center shrink-0">
            <svg width="14" height="14" viewBox="0 0 20 20">
              <polygon points="10,0 20,10 10,20 0,10" fill="#FAEEDA" stroke="#EF9F27" strokeWidth="1.5" />
            </svg>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-medium text-slate-700">Point de décision</span>
            <span className="text-[10px] text-slate-400 leading-tight">
              <span className="text-[#854F0B] font-semibold">oui</span> (ligne pleine) / <span className="text-slate-500 font-semibold">sinon</span> (pointillé)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
