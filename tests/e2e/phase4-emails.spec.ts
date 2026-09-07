import { expect, test } from '@playwright/test';

/**
 * Ce que le répondant voit une fois son formulaire envoyé.
 *
 * L'e-mail part ailleurs, dans un service tiers, et ne se vérifie donc pas d'ici.
 * L'écran de remerciement, lui, est le seul retour que la plupart des répondants
 * liront : il porte le numéro qu'ils citeront s'ils écrivent, et il est rédigé
 * par l'auteur — donc rien ne garantit qu'il s'affiche, sinon ceci.
 *
 * Le formulaire visé est celui de `fixtures/phase4-emails.sql`. Les tests sont
 * ignorés quand E2E_EMAILS_SLUG est absent, pour qu'une exécution sans base à
 * disposition ne se transforme pas en échec.
 */

const slug = process.env.E2E_EMAILS_SLUG;

test.describe('Confirmation et numérotation', () => {
  test.skip(!slug, 'E2E_EMAILS_SLUG non défini');

  async function fill(page: import('@playwright/test').Page, formule: string) {
    await page.goto(`/f/${slug}`);
    // Repérés par leur invite et non par leur libellé : dans la vue publique, le
    // `<label>` d'une question n'est associé à aucun contrôle — ni `for`, ni
    // imbrication. C'est un défaut d'accessibilité réel, antérieur à cette
    // phase et commun à tous les types de champ ; il est noté pour la phase 8,
    // qui reprend le durcissement du rendu public.
    await page.getByPlaceholder('Votre réponse').fill('Livinia');
    await page.getByPlaceholder('vous@exemple.com').fill('delivered@resend.dev');
    await page.getByRole('button', { name: new RegExp(`^${formule}`) }).click();
    await page.getByRole('button', { name: /Envoyer|Terminer|Soumettre/i }).click();
  }

  test('l’écran de remerciement dit ce que l’auteur a écrit', async ({ page }) => {
    await fill(page, 'Table de 6');

    // Le titre et le message viennent de `confirmation_config` ; le message
    // porte un jeton, résolu sur la réponse qui vient d'être envoyée.
    await expect(page.getByRole('heading', { name: 'Inscription enregistree' })).toBeVisible();
    await expect(page.getByText('A bientot, Livinia.')).toBeVisible();
    await expect(page.getByText('Un e-mail vient de vous etre envoye.')).toBeVisible();
  });

  test('le numéro de bon de commande est affiché, et se recopie', async ({ page }) => {
    await fill(page, 'Place seule');

    await expect(page.getByText('Votre reference')).toBeVisible();

    // Le numéro suit la séquence du projet : préfixe, tiret, quatre chiffres.
    const reference = page.locator('.font-mono').first();
    await expect(reference).toHaveText(/^SONDE-\d{4}$/);
  });

  test('deux envois ne reçoivent jamais le même numéro', async ({ page }) => {
    // C'est la propriété que la séquence doit tenir : sans elle, deux
    // inscriptions porteraient la même référence, et rien dans le dossier ne
    // permettrait de les distinguer.
    //
    // Strictement croissant, et non « le suivant » : d'autres envois peuvent
    // s'intercaler — les tests eux-mêmes s'exécutent en parallèle, et un
    // formulaire réel reçoit plusieurs inscriptions à la fois. L'absence de trou
    // dans la séquence est une propriété de la fonction SQL, vérifiée là où elle
    // se vérifie : par huit sessions concurrentes sur la base.
    await fill(page, 'Place seule');
    const first = await page.locator('.font-mono').first().innerText();

    await fill(page, 'Place seule');
    const second = await page.locator('.font-mono').first().innerText();

    const number = (text: string) => Number(text.split('-')[1]);
    expect(number(second)).toBeGreaterThan(number(first));
  });
});
