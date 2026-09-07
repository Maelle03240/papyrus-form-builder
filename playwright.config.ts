import { defineConfig, devices } from '@playwright/test';

/**
 * Parcours de bout en bout. Ils visent le formulaire public, la tarification et
 * le parcours partenaire — c'est-à-dire ce qu'un visiteur peut casser sans
 * jamais se connecter.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
