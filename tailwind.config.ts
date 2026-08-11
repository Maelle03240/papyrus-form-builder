import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        /**
         * Palette Mooove — charte V1.0. Ces six valeurs sont la référence ;
         * elles ne doivent pas être redéfinies ailleurs.
         */
        mooove: {
          navy: '#052139',
          cyan: '#2ac2de',
          amber: '#f6923e',
          electric: '#3c5eab',
          ice: '#eff9fe',
          sky: '#c7eafb'
        },
        /**
         * Ancien nuancier « parchemin » du produit Papyrus.
         *
         * Il est conservé comme alias parce qu'une centaine d'utilisations
         * (`bg-papyrus-surface`, `border-papyrus-border`…) sont réparties dans
         * les composants — mais chaque entrée pointe désormais vers un token
         * sémantique Mooove. Repointer ici plutôt que réécrire chaque fichier
         * garantit qu'aucun beige n'a été oublié quelque part.
         */
        papyrus: {
          bg: 'var(--bg-base)',
          surface: 'var(--bg-surface)',
          border: 'var(--border)',
          muted: 'var(--text-secondary)',
          ink: 'var(--text-primary)'
        },
        // Semantic tokens (driven by CSS variables in globals.css)
        bg: {
          base: 'var(--bg-base)',
          surface: 'var(--bg-surface)',
          elevated: 'var(--bg-elevated)',
          overlay: 'var(--bg-overlay)'
        },
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)'
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)'
        },
        accent: {
          DEFAULT: 'var(--accent)',
          cta: 'var(--accent-cta)',
          warm: 'var(--accent-warm)',
          bold: 'var(--accent-bold)'
        },
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)'
      },
      fontFamily: {
        display: 'var(--font-display)',
        sans: 'var(--font-body)',
        serif: 'var(--font-serif)',
        mono: 'var(--font-mono)'
      },
      /**
       * Coins arrondis de la charte :
       *   compact  (8 px)  — inputs, badges
       *   standard (12 px) — boutons, panneaux
       *   cards    (20 px) — cartes du dashboard, blocs du builder
       */
      borderRadius: {
        DEFAULT: 'var(--radius-sm)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-md)',
        xl: 'var(--radius-md)',
        '2xl': 'var(--radius-lg)',
        '3xl': 'var(--radius-lg)'
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'slide-up': 'slide-up 280ms cubic-bezier(0.22, 1, 0.36, 1)'
      }
    }
  },
  plugins: []
};

export default config;