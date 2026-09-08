import { expect, test } from '@playwright/test';

/**
 * Le parcours partenaire, du côté où personne n'est connecté.
 *
 * Un visiteur arrive par le lien d'un partenaire qu'il connaît, tombe sur une
 * page qui ne parle que de l'événement, clique, remplit, envoie. La commission
 * n'existe qu'au bout de cette chaîne — et chaque maillon est ailleurs : une
 * page serveur, un paramètre d'URL, un cookie de visiteur, une route d'envoi.
 * Aucun test unitaire ne les tient ensemble.
 *
 * Ce que ces tests NE prouvent pas : que la commission est correctement
 * calculée — c'est `tests/unit/partners.test.ts` — ni que la ligne
 * `project_partner_id` est bien écrite, qui se lit en base. Ils prouvent que le
 * chemin existe et qu'il ne perd personne en route.
 *
 * Support : `fixtures/phase8-partner.sql`. Ignorés sans E2E_PARTNER_CODE.
 */

const code = process.env.E2E_PARTNER_CODE;
const foreignCode = process.env.E2E_PARTNER_FOREIGN_CODE;
const joinToken = process.env.E2E_PARTNER_JOIN_TOKEN;

test.describe('Parcours partenaire', () => {
  test.skip(!code, 'E2E_PARTNER_CODE non défini');

  test('la page d’accueil nomme le partenaire et mène au formulaire', async ({ page }) => {
    await page.goto(`/a/${code}`);

    // Le partenaire est nommé en haut : c'est sa recommandation qui amène le
    // visiteur. Le reléguer sous le pli reviendrait à la retirer.
    await expect(page.getByText('En partenariat avec')).toBeVisible();
    await expect(page.getByText('Agence Corail')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Le grand départ 2026' })
    ).toBeVisible();

    const cta = page.getByRole('link', { name: /Je m’inscris/ });
    await expect(cta).toBeVisible();

    // Le code voyage dans l'adresse : sans lui, le formulaire s'ouvre quand
    // même et l'inscription n'est attribuée à personne.
    await expect(cta).toHaveAttribute('href', new RegExp(`a=${code}`));
  });

  test('rien de l’espace de travail ne transparaît sur la page d’accueil', async ({ page }) => {
    await page.goto(`/a/${code}`);

    const body = (await page.locator('body').innerText()).toLowerCase();

    // Ni le taux de commission, ni l'adresse du partenaire, ni le nom interne
    // du projet : la page est faite pour un visiteur, pas pour l'équipe.
    expect(body).not.toContain('commission');
    expect(body).not.toContain('corail@exemple.mu');
    expect(body).not.toContain('sonde partenaires');
  });

  test('un code inconnu ne mène nulle part', async ({ page }) => {
    const response = await page.goto('/a/codequinexistepas');
    expect(response?.status()).toBe(404);
  });

  test('le formulaire attribué s’ouvre et s’envoie', async ({ page }) => {
    await page.goto(`/a/${code}`);
    await page.getByRole('link', { name: /Je m’inscris/ }).click();

    await expect(page).toHaveURL(new RegExp(`a=${code}`));

    await page.getByLabel('Nom complet').fill('Visiteur Sonde');
    await page.getByLabel('Adresse e-mail').fill(`sonde+${Date.now()}@exemple.mu`);
    await page.getByRole('button', { name: /Envoyer|Valider|Terminer/ }).click();

    await expect(page.getByText(/merci|enregistr/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('un code valide mais étranger au projet n’empêche pas l’envoi', async ({ page }) => {
    test.skip(!foreignCode, 'E2E_PARTNER_FOREIGN_CODE non défini');

    // Le code appartient à un autre projet. L'attribution est refusée en
    // silence côté serveur — mais la réponse, elle, arrive : perdre une
    // inscription coûterait plus cher qu'une commission non attribuée.
    await page.goto(`/f/${process.env.E2E_PARTNER_FORM_SLUG}?a=${foreignCode}`);

    await page.getByLabel('Nom complet').fill('Visiteur Etranger');
    await page.getByLabel('Adresse e-mail').fill(`etranger+${Date.now()}@exemple.mu`);
    await page.getByRole('button', { name: /Envoyer|Valider|Terminer/ }).click();

    await expect(page.getByText(/merci|enregistr/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('la page d’auto-inscription demande ce qu’il faut, et rien de plus', async ({ page }) => {
    test.skip(!joinToken, 'E2E_PARTNER_JOIN_TOKEN non défini');

    await page.goto(`/a/join/${joinToken}`);

    await expect(page.getByLabel('Nom ou raison sociale')).toBeVisible();
    await expect(page.getByLabel('Adresse e-mail')).toBeVisible();

    // Un prospect ne voit ni le taux de commission, ni qui est déjà inscrit :
    // la relation n'existe pas encore.
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain('commission');
    expect(body).not.toContain('agence corail');
  });
});
