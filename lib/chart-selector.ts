import type { Field } from '@/types';

export type ChartKind = 'pie' | 'bar' | 'bar_horizontal' | 'number_big' | 'list' | 'histogram' | 'heatmap';

/**
 * Deterministically selects the chart kind for a field.
 */
export function selectChartKind(field: Field, _responseCount: number): ChartKind {
  switch (field.type) {
    case 'yesno':
      // Deux valeurs, jamais plus : le camembert est ici parfaitement lisible.
      return 'pie';
    case 'single_choice':
    case 'dropdown':
      return (field.options ?? []).length <= 6 ? 'pie' : 'bar_horizontal';
    case 'country':
      return 'bar_horizontal';
    case 'multiple_choice':
      return 'bar_horizontal';
    case 'rating':
    case 'nps':
      return 'bar'; // average score is shown separately above
    case 'matrix':
      return 'heatmap'; // toggle available to 'bar' grouped by row
    case 'date':
    case 'number':
    case 'currency':
    case 'calculated':
      return 'histogram';
    case 'short_text':
    case 'long_text':
    case 'email':
    case 'phone':
    case 'url':
    default:
      return 'list'; // no chart, scrollable list of responses
  }
}

export interface OptionCount {
  label: string;
  count: number;
  _grouped?: OptionCount[];
}

/**
 * Prepares data for a pie chart by grouping smaller slices into an "Autres" category.
 */
export function preparePieData(optionCounts: OptionCount[], maxSlices = 5): OptionCount[] {
  const sorted = [...optionCounts].sort((a, b) => b.count - a.count);
  if (sorted.length <= maxSlices) return sorted;
  
  const top = sorted.slice(0, maxSlices);
  const rest = sorted.slice(maxSlices);
  const othersCount = rest.reduce((sum, o) => sum + o.count, 0);
  
  return [...top, { label: 'Autres', count: othersCount, _grouped: rest }];
}
