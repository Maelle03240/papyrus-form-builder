import type { Field, FieldType, FormTheme } from '@/types';

export const DEFAULT_FIELD_ICONS: Record<FieldType, string> = {
  short_text:      'ti-text-size',
  long_text:       'ti-align-left',
  email:           'ti-mail',
  phone:           'ti-phone',
  number:          'ti-hash',
  url:             'ti-link',
  date:            'ti-calendar',
  single_choice:   'ti-circle-dot',
  multiple_choice: 'ti-checkbox',
  dropdown:        'ti-selector',
  rating:          'ti-star',
  nps:             'ti-chart-bar',
  file:            'ti-paperclip',
  image:           'ti-photo',
  video:           'ti-video',
  matrix:          'ti-layout-rows',
  statement:       'ti-info-circle',
};

export function getFieldIcon(field: Field): string {
  return field.style?.icon_value ?? DEFAULT_FIELD_ICONS[field.type] ?? 'ti-question-mark';
}

export function isIconVisible(field: Field, theme: FormTheme): boolean {
  // override local prioritaire sur global
  if (field.style?.icon_enabled === true)  return true;
  if (field.style?.icon_enabled === false) return false;
  return theme.fields_icons_enabled ?? false;
}
