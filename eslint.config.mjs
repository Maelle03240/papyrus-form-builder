// eslint.config.mjs — configuration « flat », requise par ESLint 10.
//
// Remplace `.eslintrc.json`. Le script `lint` appelle désormais `eslint .`
// directement : `next lint` a été retiré de la CLI Next.js en v16.

import { defineConfig, globalIgnores } from 'eslint/config';
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'next-env.d.ts',
    // Catalogue de modèles auto-généré (~600 Ko) : régénéré par
    // `npm run templates:build`, jamais édité à la main.
    'lib/templates/generated.ts'
  ]),

  ...coreWebVitals,
  ...nextTypescript,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      '@next/next/no-img-element': 'off',
      'react/no-unescaped-entities': 'off',

      /*
       * Règles du React Compiler, apparues avec eslint-plugin-react-hooks v6
       * (embarqué par eslint-config-next 16). Elles signalent du code qui existe
       * depuis longtemps : la montée de version les a révélées, elle ne les a
       * pas causées.
       *
       * Elles sont en avertissement, pas en erreur, parce que les corriger est
       * un vrai travail de refactorisation — pas la montée de stack. Mais ce
       * sont de vrais défauts, et le React Compiler ne pourra pas être activé
       * tant qu'ils sont là. État au 07/09/2026, à faire décroître :
       *
       *   31  set-state-in-effect          appel d'état dans un effet
       *   13  refs                         lecture/écriture de ref au rendu
       *    6  static-components            composant redéfini à chaque rendu
       *    5  immutability                 mutation d'une valeur du rendu
       *    2  preserve-manual-memoization  mémoïsation cassée
       *    2  purity                       effet de bord pendant le rendu
       */
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/purity': 'warn'
    }
  }
]);
