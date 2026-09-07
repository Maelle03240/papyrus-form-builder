import { expect, test } from '@playwright/test';

/**
 * Parcours de bout en bout de la tarification, sur le formulaire public.
 *
 * Ce que ces tests couvrent ne se vérifie nulle part ailleurs : le total se
 * recalcule dans le navigateur du répondant, à chaque frappe, et c'est ce
 * montant-là qu'il croit devoir payer. Les tests unitaires fixent le moteur, la
 * base fixe le gel à l'envoi — entre les deux, il n'y a que ceci.
 *
 * Le formulaire visé est celui de `fixtures/phase3-pricing.sql`. Les tests sont
 * ignorés quand E2E_PRICING_SLUG est absent, pour qu'une exécution sans base à
 * disposition ne se transforme pas en échec.
 */

const slug = process.env.E2E_PRICING_SLUG;

test.describe('Tarification', () => {
  test.skip(!slug, 'E2E_PRICING_SLUG non défini');

  test('le prix s’affiche à côté de l’option, là où l’on choisit', async ({ page }) => {
    await page.goto(`/f/${slug}`);
    await expect(page.getByText('Table de 6').first()).toBeVisible();
    await expect(page.getByText('MUR 3 000,00').first()).toBeVisible();
  });

  test('le total suit le compteur de quantité', async ({ page }) => {
    await page.goto(`/f/${slug}`);

    const summary = page.getByRole('region', { name: 'Récapitulatif' });
    await expect(summary).toContainText('Rien de facturable');

    await page.getByRole('button', { name: /^Table de 6/ }).click();
    await expect(summary).toContainText('MUR 3 000,00');

    // Trois tables : le prix de l'option est multiplié, pas répété.
    const plus = page.getByRole('button', { name: 'Ajouter un Table de 6' });
    await plus.click();
    await plus.click();

    await expect(summary).toContainText('MUR 9 000,00');
    await expect(summary).toContainText('TVA');
  });

  test('une option masquée par un verrou n’est jamais facturée', async ({ page }) => {
    await page.goto(`/f/${slug}`);
    const summary = page.getByRole('region', { name: 'Récapitulatif' });

    await page.getByRole('button', { name: 'Oui' }).click();
    await page.getByRole('button', { name: /^Aller simple/ }).click();
    await expect(summary).toContainText('Aller simple');

    // Le répondant change d'avis : la navette quitte l'écran, et le total.
    await page.getByRole('button', { name: 'Non' }).click();
    await expect(summary).not.toContainText('Aller simple');
  });

  test('le code de réduction dit s’il est reconnu', async ({ page }) => {
    await page.goto(`/f/${slug}`);
    const summary = page.getByRole('region', { name: 'Récapitulatif' });

    await page.getByRole('button', { name: /^Place seule/ }).click();
    await expect(summary).toContainText('MUR 600,00');

    const code = page.getByLabel('Code de réduction');
    await code.fill('NIMPORTEQUOI');
    await expect(summary).toContainText('Inconnu');

    await code.fill('EARLY20');
    await expect(summary).toContainText('Appliqué');
    await expect(summary).toContainText('Remise (20 %)');
  });
});
