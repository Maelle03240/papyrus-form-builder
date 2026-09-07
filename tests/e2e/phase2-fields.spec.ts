import { expect, test } from '@playwright/test';

/**
 * Parcours de bout en bout des champs de la phase 2, sur le formulaire public.
 *
 * Ce que ces tests couvrent ne se vérifie nulle part ailleurs : le verrou de
 * visibilité, le total calculé et le pré-remplissage depuis l'adresse vivent
 * dans le navigateur du répondant. Les tests unitaires fixent l'évaluateur, la
 * base fixe le stockage — entre les deux, il n'y a que ceci.
 *
 * Le formulaire visé est celui que désigne E2E_FORM_SLUG. Les tests sont ignorés
 * quand la variable est absente, pour qu'une exécution sans base à disposition
 * ne se transforme pas en échec.
 */

const slug = process.env.E2E_FORM_SLUG;

test.describe('Champs de la phase 2', () => {
  test.skip(!slug, 'E2E_FORM_SLUG non défini');

  test('le bloc répétable reste fermé tant que la question qui le commande dit non', async ({
    page
  }) => {
    await page.goto(`/f/${slug}`);

    const repeater = page.getByText('Accompagnant 1');
    await expect(repeater).toBeHidden();

    await page.getByRole('button', { name: 'Oui' }).click();
    await expect(repeater).toBeVisible();

    await page.getByRole('button', { name: 'Non' }).click();
    await expect(repeater).toBeHidden();
  });

  test('le total se met à jour à chaque ligne ajoutée', async ({ page }) => {
    await page.goto(`/f/${slug}`);

    await page.getByRole('button', { name: 'Oui' }).click();

    // Une ligne vide n'est pas un participant : seul le décalage compte encore.
    const total = page.locator('output').filter({ hasText: 'Total compté' });
    await expect(total).toContainText('1');

    await page.getByRole('textbox', { name: 'Nom' }).first().fill('Livinia');
    await expect(total).toContainText('2');

    await page.getByRole('button', { name: /Ajouter accompagnant/i }).click();
    await expect(total).toContainText('2');

    await page.getByRole('textbox', { name: 'Nom' }).nth(1).fill('Keven');
    await expect(total).toContainText('3');
  });

  test('le champ caché prend la valeur passée dans l’adresse', async ({ page }) => {
    // Rien ne s'affiche à l'écran : la preuve est dans ce qui part à l'envoi.
    await page.goto(`/f/${slug}?utm_source=linkedin`);

    const [request] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/api/submit/')),
      submitForm(page)
    ]);

    expect(JSON.stringify(request.postDataJSON())).toContain('linkedin');
  });
});

async function submitForm(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /Envoyer/i }).click();
}
