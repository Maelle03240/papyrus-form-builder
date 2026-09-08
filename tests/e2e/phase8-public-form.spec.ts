import { expect, test } from '@playwright/test';

/**
 * Le formulaire public, vu comme un lecteur d'écran le voit.
 *
 * Ces tests désignent chaque champ **par le libellé de sa question**, jamais par
 * son invite ni par sa position. C'est délibéré : `getByLabel` ne trouve un
 * contrôle que si quelque chose lui donne réellement un nom — un `<label for>`,
 * une imbrication, un `aria-labelledby`. Un formulaire dont les libellés ne sont
 * que du texte à côté des champs s'affiche parfaitement et échoue ici.
 *
 * C'est ce qui manquait jusqu'à la phase 8, pour tous les types de champ à la
 * fois : le défaut avait été relevé en écrivant les tests de la phase 4, où il
 * obligeait déjà à viser les champs par leur invite.
 *
 * Le formulaire visé est celui de `fixtures/phase8-public.sql`. Les tests sont
 * ignorés quand E2E_PUBLIC_SLUG est absent, pour qu'une exécution sans base à
 * disposition ne se transforme pas en échec.
 */

const slug = process.env.E2E_PUBLIC_SLUG;

test.describe('Rendu public — nommage des champs', () => {
  test.skip(!slug, 'E2E_PUBLIC_SLUG non défini');

  test.beforeEach(async ({ page }) => {
    await page.goto(`/f/${slug}`);
  });

  test('chaque champ à contrôle unique porte le nom de sa question', async ({ page }) => {
    // Cinq types différents, cinq rendus différents, un seul contrat : le
    // contrôle s'appelle comme la question.
    await expect(page.getByLabel('Nom complet')).toBeVisible();
    await expect(page.getByLabel('Adresse e-mail')).toBeVisible();
    await expect(page.getByLabel('Commentaire libre')).toBeVisible();
    await expect(page.getByLabel('Nombre d’accompagnants', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Date d’arrivée', { exact: false })).toBeVisible();
  });

  test('le libellé donne le focus au champ qu’il désigne', async ({ page }) => {
    // Ce que `aria-labelledby` seul ne ferait pas : cliquer le texte pose le
    // curseur dans le champ. C'est la preuve que le `for` est bien là.
    // Pas `exact` : le libellé porte aussi l'astérisque et la mention
    // « obligatoire ». C'est bien l'élément le plus profond qui contient le
    // texte, et il est dans le `<label>` — le cliquer active le rattachement.
    await page.getByText('Nom complet').first().click();
    await expect(page.getByLabel('Nom complet')).toBeFocused();
  });

  test('on remplit le formulaire en ne connaissant que les questions', async ({ page }) => {
    await page.getByLabel('Nom complet').fill('Livinia Bouchet');
    await page.getByLabel('Adresse e-mail').fill('livinia@exemple.mu');
    await page.getByLabel('Commentaire libre').fill('Rien à signaler.');

    await expect(page.getByLabel('Nom complet')).toHaveValue('Livinia Bouchet');
    await expect(page.getByLabel('Adresse e-mail')).toHaveValue('livinia@exemple.mu');
  });

  test('une liste déroulante se choisit par le nom de sa question', async ({ page }) => {
    await page.getByLabel('Pays de résidence').selectOption({ label: 'Maurice' });
    await expect(page.getByLabel('Pays de résidence')).toHaveValue(/.+/);
  });

  test('une question à choix est un groupe nommé, pas une étiquette de bouton', async ({
    page
  }) => {
    // Le nom appartient à l'ensemble. S'il était posé par un `<label for>`, il
    // désignerait « Journée » et la question disparaîtrait de l'arbre.
    await expect(page.getByRole('group', { name: 'Formule choisie' })).toBeVisible();
    await expect(page.getByRole('group', { name: /Êtes-vous déjà venu/ })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Votre satisfaction' })).toBeVisible();
  });

  test('« obligatoire » se dit, l’astérisque ne s’entend pas', async ({ page }) => {
    // L'astérisque rouge est décoratif : à l'oreille, il ne produit rien, ou
    // « étoile ». Le mot, lui, se lit avec le nom du champ.
    await expect(page.getByLabel(/Nom complet.*obligatoire/)).toBeVisible();
    await expect(page.getByLabel('Commentaire libre')).toBeVisible();
    await expect(page.getByLabel(/Commentaire libre.*obligatoire/)).toHaveCount(0);
  });

  test('la description est rattachée au champ, pas seulement posée à côté', async ({ page }) => {
    const input = page.getByLabel('Nom complet');
    const describedBy = await input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    await expect(page.locator(`#${describedBy}`)).toContainText('pièce d’identité', {
      // La casse et les apostrophes viennent de la base ; seule compte la
      // présence du texte.
      ignoreCase: true
    });
  });

  test('la page n’a qu’un seul élément par identifiant', async ({ page }) => {
    // Deux contrôles portant le même `id` feraient pointer les libellés vers le
    // premier, et le second serait muet — sans que rien ne s'affiche de travers.
    const ids = await page.locator('[id]').evaluateAll((nodes) =>
      nodes.map((node) => node.id).filter(Boolean)
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
