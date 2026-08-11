import type { CSSProperties } from 'react';
import type { FormTheme } from '@/types';

export interface BackgroundPreset {
  id: string;
  label: string;
  apply: Partial<FormTheme>;
}

/**
 * Fonds proposés aux créateurs de formulaires.
 *
 * Tous sont construits à partir des six couleurs de la charte Mooove. Le
 * dégradé « Chaleur » est le seul à utiliser l'Ambre — et il n'y a pas de Cyan
 * dedans, la charte interdisant d'associer les deux dans un même bloc visuel.
 */
export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  {
    id: 'ice',
    label: 'Ice',
    apply: { bg_type: 'color', bg_color: '#EFF9FE', bg: '#EFF9FE' }
  },
  {
    id: 'blanc',
    label: 'Blanc',
    apply: { bg_type: 'color', bg_color: '#FFFFFF', bg: '#FFFFFF' }
  },
  {
    id: 'aube',
    label: 'Aube',
    apply: {
      bg_type: 'gradient',
      bg_gradient_from: '#EFF9FE',
      bg_gradient_to: '#C7EAFB',
      bg_gradient_angle: 160,
      bg: 'linear-gradient(160deg, #EFF9FE, #C7EAFB)'
    }
  },
  {
    id: 'chaleur',
    label: 'Chaleur',
    apply: {
      bg_type: 'gradient',
      bg_gradient_from: '#F6923E',
      bg_gradient_to: '#052139',
      bg_gradient_angle: 180,
      bg: 'linear-gradient(180deg, #F6923E, #052139)'
    }
  },
  {
    id: 'mouvement',
    label: 'Mouvement',
    apply: {
      bg_type: 'gradient',
      bg_gradient_from: '#2AC2DE',
      bg_gradient_to: '#052139',
      bg_gradient_angle: 165,
      bg: 'linear-gradient(165deg, #2AC2DE, #052139)'
    }
  },
  {
    id: 'brume',
    label: 'Brume',
    apply: {
      bg_type: 'gradient',
      bg_gradient_from: '#EFF9FE',
      bg_gradient_to: '#FFFFFF',
      bg_gradient_angle: 180,
      bg: 'linear-gradient(180deg, #EFF9FE, #FFFFFF)'
    }
  },
  {
    id: 'ardoise',
    label: 'Ardoise',
    apply: { bg_type: 'color', bg_color: '#052139', bg: '#052139' }
  }
];

/** Résout les propriétés de theme en valeur CSS background utilisable. */
export function getBackgroundStyle(theme: FormTheme): CSSProperties {
  const type = theme.bg_type ?? 'color';

  switch (type) {
    case 'gradient': {
      const angle = theme.bg_gradient_angle ?? 135;
      const from = theme.bg_gradient_from ?? '#EFF9FE';
      const to = theme.bg_gradient_to ?? '#EFF9FE';
      return { backgroundImage: `linear-gradient(${angle}deg, ${from}, ${to})` };
    }
    case 'image': {
      if (!theme.bg_image_url) {
        return { backgroundColor: theme.bg_color ?? theme.bg ?? '#EFF9FE' };
      }
      const opacity = (theme.bg_image_opacity ?? 0) / 100;
      // Voile Ice Blue translucide par-dessus l'image, pour garder le texte lisible
      const overlay =
        opacity > 0
          ? `linear-gradient(rgba(239, 249, 254, ${opacity}), rgba(239, 249, 254, ${opacity})), `
          : '';
      return {
        backgroundImage: `${overlay}url(${theme.bg_image_url})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      };
    }
    case 'color':
    case 'preset':
    default:
      return { backgroundColor: theme.bg_color ?? theme.bg ?? '#EFF9FE' };
  }
}

/** Résout les propriétés CSS pour la bannière. */
export function getBannerStyle(theme: FormTheme): CSSProperties {
  const fit = theme.banner_fit ?? 'cover';
  const position = theme.banner_position ?? 'center';
  return {
    objectFit: fit,
    objectPosition: position,
    backgroundColor: fit === 'contain' ? '#EFF9FE' : undefined
  };
}
