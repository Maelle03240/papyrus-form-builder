import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` lève dès son import hors d'un composant serveur : c'est
      // exactement son rôle dans l'application, et exactement ce qui empêche de
      // tester un module serveur. Le neutraliser ici ne retire aucune garantie —
      // c'est le build de Next qui fait respecter la frontière, pas Vitest.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    globals: false
  }
});
