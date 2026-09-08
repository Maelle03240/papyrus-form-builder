import fs from 'node:fs';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * La revue de bout en bout de l'application, connectée.
 *
 * Les autres fichiers de `tests/e2e` visent chacun une fonctionnalité. Celui-ci
 * vise l'inverse : il traverse TOUT — chaque écran du tableau de bord, chaque
 * onglet d'un projet et d'un formulaire, le constructeur, l'aperçu, les trois
 * modes d'affichage, la publication, la réponse publique — et échoue au premier
 * écran qui casse.
 *
 * Il existe parce qu'un défaut de rendu ne se voit dans aucun test unitaire et
 * dans aucune vérification de type. Ce qu'il a trouvé à sa première exécution :
 * un séparateur promu en écran plein numéroté, un champ caché devenu une
 * question, un intitulé affiché deux fois, et le message « ajoutez-en dans le
 * panneau de droite » — destiné à l'auteur — montré au répondant sur un
 * formulaire publié.
 *
 * **Chaque page est écoutée.** Une erreur de console ou une exception non
 * rattrapée fait échouer le test qui l'a provoquée, même si l'écran a l'air
 * correct : c'est exactement la forme que prend un composant qui tombe pendant
 * l'hydratation — la page s'affiche, puis ne réagit plus.
 *
 * Il lui faut une session et un formulaire d'essai :
 *   E2E_SESSION_FILE   le fichier écrit par la préparation (compte, équipe, cookie)
 *   E2E_AUDIT_SLUG     l'adresse publique du formulaire d'essai
 *   E2E_AUDIT_FORM     son identifiant
 *   E2E_AUDIT_PROJECT  celui de son projet
 * Sans eux, tout est ignoré.
 */

const sessionFile = process.env.E2E_SESSION_FILE;

interface AuditSession {
  teamId: string;
  cookieName: string;
  cookieValue: string;
  accessToken: string;
  supabaseUrl: string;
  anonKey: string;
}

const session: AuditSession | null = sessionFile
  ? (JSON.parse(fs.readFileSync(sessionFile, 'utf8')) as AuditSession)
  : null;

const SLUG = process.env.E2E_AUDIT_SLUG ?? '';
const FORM = process.env.E2E_AUDIT_FORM ?? '';
const PROJECT = process.env.E2E_AUDIT_PROJECT ?? '';

/**
 * Ce qu'on accepte de voir passer dans la console.
 *
 * La liste est courte et le restera : chaque ligne ici est un bruit qu'on a
 * regardé et jugé inoffensif. Tout le reste fait échouer.
 */
const IGNORED_CONSOLE = ['Failed to load resource', 'favicon', 'Extra attributes from the server'];

function watchConsole(page: Page): string[] {
  const errors: string[] = [];

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (IGNORED_CONSOLE.some((pattern) => text.includes(pattern))) return;
    errors.push(text);
  });

  page.on('pageerror', (error) => {
    errors.push(`exception : ${error.message}`);
  });

  return errors;
}

/** Next affiche ses plantages dans un gabarit reconnaissable. */
async function expectNoCrash(page: Page) {
  await expect(page.locator('text=Application error')).toHaveCount(0);
  await expect(page.locator('text=Unhandled Runtime Error')).toHaveCount(0);
  await expect(page.locator('#__next_error__')).toHaveCount(0);
}

/**
 * Le mode d'affichage, changé en base plutôt que par l'interface.
 *
 * Le test du constructeur vise le BASCULEMENT ; ceux-ci visent le RENDU. Les
 * mélanger ferait qu'un défaut de l'un masquerait celui de l'autre.
 */
async function patchForm(page: Page, data: Record<string, unknown>) {
  const response = await page.request.patch(
    `${session!.supabaseUrl}/rest/v1/forms?slug=eq.${SLUG}`,
    {
      headers: {
        apikey: session!.anonKey,
        Authorization: `Bearer ${session!.accessToken}`,
        'Content-Type': 'application/json',
        'Content-Profile': 'papyrus'
      },
      data
    }
  );
  expect(response.ok(), `mise à jour du formulaire ${JSON.stringify(data)}`).toBeTruthy();
}

async function setDisplayMode(page: Page, mode: string) {
  await patchForm(page, { display_mode: mode });
}

test.describe('Revue complète', () => {
  test.skip(!session, 'E2E_SESSION_FILE non défini');

  test.beforeEach(async ({ context, baseURL }) => {
    if (!session) return;
    const origin = new URL(baseURL ?? 'http://localhost:3100').origin;
    await context.addCookies([
      {
        name: session.cookieName,
        value: session.cookieValue,
        url: origin,
        httpOnly: false,
        secure: origin.startsWith('https')
      }
    ]);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. Chaque écran du tableau de bord s'ouvre
  // ══════════════════════════════════════════════════════════════════════════

  const SCREENS: { path: string; expect: RegExp }[] = [
    { path: '/dashboard', expect: /Papyrus|Tableau|Bonjour|formulaire/i },
    { path: '/projects', expect: /Projets/i },
    { path: '/projects/nouveau', expect: /projet/i },
    { path: '/forms', expect: /formulaire/i },
    { path: '/templates', expect: /Mod[èe]le/i },
    { path: '/partners', expect: /Partenaire/i },
    { path: '/contacts', expect: /Contact/i },
    { path: '/settings/profile', expect: /Profil/i },
    { path: '/settings/team', expect: /[ÉE]quipe/i },
    { path: '/settings/assistant', expect: /Assistant/i },
    { path: '/settings/integrations', expect: /Int[ée]gration|Tally/i },
    { path: '/settings/access', expect: /Acc[èe]s|domaine/i }
  ];

  for (const screen of SCREENS) {
    test(`écran ${screen.path}`, async ({ page }) => {
      const errors = watchConsole(page);

      const response = await page.goto(screen.path);
      expect(response?.status(), `${screen.path} répond`).toBeLessThan(400);

      await expectNoCrash(page);
      await expect(page.locator('body')).toContainText(screen.expect, { timeout: 15_000 });

      // Le temps que les effets de chargement se déclenchent : c'est là que
      // tombent les composants qui lisent une donnée absente.
      await page.waitForTimeout(1200);
      await expectNoCrash(page);

      expect(errors, `console de ${screen.path}`).toEqual([]);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Les onglets d'un projet et d'un formulaire
  // ══════════════════════════════════════════════════════════════════════════

  test('les onglets du projet', async ({ page }) => {
    test.skip(!PROJECT, 'E2E_AUDIT_PROJECT non défini');
    test.setTimeout(120_000);
    const errors = watchConsole(page);

    for (const tab of ['forms', 'records', 'partners', 'insights', 'settings']) {
      await page.goto(`/projects/${PROJECT}?tab=${tab}`);
      await page.waitForTimeout(1800);
      await expectNoCrash(page);
    }

    expect(errors, 'console des onglets de projet').toEqual([]);
  });

  test('les onglets du formulaire', async ({ page }) => {
    test.skip(!PROJECT || !FORM, 'E2E_AUDIT_FORM non défini');
    test.setTimeout(240_000);
    const errors = watchConsole(page);

    const base = `/projects/${PROJECT}/forms/${FORM}`;
    const routes = [
      `${base}?tab=setup&sub=build`,
      `${base}?tab=setup&sub=design`,
      `${base}?tab=setup&sub=pricing`,
      `${base}?tab=setup&sub=email`,
      `${base}?tab=setup&sub=integrations`,
      `${base}?tab=setup&sub=settings`,
      `${base}?tab=records`,
      `${base}?tab=insights`,
      `${base}?tab=share`
    ];

    for (const route of routes) {
      await page.goto(route);
      await page.waitForTimeout(2200);
      await expectNoCrash(page);
    }

    expect(errors, 'console des onglets de formulaire').toEqual([]);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Le constructeur : créer, ajouter, changer de mode, prévisualiser
  // ══════════════════════════════════════════════════════════════════════════

  test('construire un formulaire et basculer entre les trois modes', async ({ page }) => {
    test.setTimeout(300_000);
    const errors = watchConsole(page);

    await page.goto('/forms');
    await page.getByRole('button', { name: /Créer un formulaire/i }).first().click();
    await page.waitForURL(/\/forms\/[0-9a-f-]+\/edit/, { timeout: 30_000 });
    await expectNoCrash(page);

    // Trois familles de rendu : une saisie, un choix (plusieurs contrôles), une
    // note. Ce sont celles que les modes traitent différemment.
    for (const label of ['Réponse courte', 'Choix unique', 'Note']) {
      await page.getByRole('button', { name: new RegExp(`^${label}`) }).first().click();
      await page.waitForTimeout(700);
    }

    await expectNoCrash(page);
    await expect(page.locator('text=Sauvegardé').first()).toBeVisible({ timeout: 25_000 });

    /**
     * Revenir au panneau d'apparence.
     *
     * Ajouter une question la sélectionne, et le panneau de droite montre alors
     * ses réglages. Le sélecteur de mode vit dans le panneau d'apparence, qui
     * ne revient qu'en cliquant le canevas lui-même — pas une carte posée
     * dessus. On vise donc la gouttière, à gauche de la colonne centrale.
     */
    const deselect = async () => {
      const canvas = page.locator('div.flex-1.h-full.overflow-y-auto').first();
      const box = await canvas.boundingBox();
      if (box) await page.mouse.click(box.x + 12, box.y + box.height - 40);
      await page.waitForTimeout(500);
    };

    for (const mode of ['Défilement', 'Une à une', 'Pages']) {
      await deselect();

      await page.getByRole('button', { name: new RegExp(mode) }).first().click();
      await page.waitForTimeout(1200);
      await expectNoCrash(page);

      // Depuis la revue, l'aperçu monte la VRAIE vue publique : ce que l'auteur
      // voit ici est ce que le répondant verra.
      await page.getByRole('button', { name: /Aperçu/ }).first().click();
      await page.waitForTimeout(2200);
      await expectNoCrash(page);

      await expect(
        page.getByRole('button', { name: /Commencer|^Envoyer|Suivant/ }).first()
      ).toBeVisible({ timeout: 10_000 });

      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    }

    expect(errors, 'console du constructeur').toEqual([]);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. La vue publique, dans les trois modes
  //
  // En série, et non en parallèle : ces tests changent le mode d'affichage du
  // MÊME formulaire. Lancés de front, chacun bascule le formulaire sous les
  // pieds des autres, et l'échec qui en résulte ne dit rien de l'application.
  // ══════════════════════════════════════════════════════════════════════════

  test.describe('Vue publique', () => {
    test.describe.configure({ mode: 'serial' });

  test('formulaire public — tout sur une page', async ({ page }) => {
    test.skip(!SLUG, 'E2E_AUDIT_SLUG non défini');
    await setDisplayMode(page, 'scroll');

    const errors = watchConsole(page);
    expect((await page.goto(`/f/${SLUG}`))?.status()).toBe(200);
    await page.waitForTimeout(1800);
    await expectNoCrash(page);

    // Tout est là d'un coup : la première question comme la dernière.
    await expect(page.getByLabel(/Nom complet/)).toBeVisible();
    await expect(page.getByText('Signature').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Envoyer/ })).toBeVisible();

    expect(errors, 'console du mode défilement').toEqual([]);
  });

  test('formulaire public — une section par page', async ({ page }) => {
    test.skip(!SLUG, 'E2E_AUDIT_SLUG non défini');
    await setDisplayMode(page, 'sections');

    const errors = watchConsole(page);
    await page.goto(`/f/${SLUG}`);
    await page.waitForTimeout(1800);
    await expectNoCrash(page);

    await expect(page.locator('body')).toContainText('Page 1 sur 2');

    // Les obligatoires bloquent le passage : c'est voulu, et c'est vérifié.
    await page.getByRole('button', { name: /Suivant/ }).first().click();
    await page.waitForTimeout(900);
    await expect(page.locator('body')).toContainText('Page 1 sur 2');

    await page.getByLabel(/Nom complet/).fill('Auditrice');
    await page.getByLabel(/Adresse e-mail/).fill('audit@exemple.mu');
    await page.getByRole('button', { name: /Suivant/ }).first().click();
    await page.waitForTimeout(1400);

    await expect(page.locator('body')).toContainText('Page 2 sur 2');
    await expect(page.getByRole('button', { name: /^Envoyer/ })).toBeVisible();

    expect(errors, 'console du mode sections').toEqual([]);
  });

  test('formulaire public — une question à la fois', async ({ page }) => {
    test.skip(!SLUG, 'E2E_AUDIT_SLUG non défini');
    await setDisplayMode(page, 'typeform');

    const errors = watchConsole(page);
    await page.goto(`/f/${SLUG}`);
    await page.waitForTimeout(1800);
    await expectNoCrash(page);

    // L'écran d'accueil annonce un nombre de questions. Il comptait les
    // séparateurs et les champs cachés : « 27 questions » pour vingt-trois.
    const intro = await page.locator('body').innerText();
    const announced = Number(intro.match(/(\d+) questions/)?.[1] ?? 0);
    expect(announced).toBeGreaterThan(0);

    await page.getByRole('button', { name: /Commencer/ }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByLabel(/Nom complet/)).toBeVisible();
    await expect(page.locator('body')).toContainText(`1 / ${announced}`);

    expect(errors, 'console du mode une-à-une').toEqual([]);
  });

  test('aucun écran ne montre le texte destiné à l’auteur', async ({ page }) => {
    test.skip(!SLUG, 'E2E_AUDIT_SLUG non défini');
    test.setTimeout(240_000);
    await setDisplayMode(page, 'typeform');

    const errors = watchConsole(page);
    await page.goto(`/f/${SLUG}`);
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: /Commencer/ }).click();
    await page.waitForTimeout(800);

    /**
     * « ajoutez-en dans le panneau de droite », « choisissez ce qui doit être
     * compté » : ces phrases s'affichaient sur un formulaire publié, devant
     * quelqu'un qui n'a pas de panneau de droite. Elles viennent de composants
     * partagés entre le constructeur et la vue publique — et le seul endroit
     * où ce défaut se voit est ici, en traversant chaque écran.
     */
    for (let step = 0; step < 40; step += 1) {
      const body = await page.locator('body').innerText();

      expect(body, `écran ${step + 1}`).not.toContain('panneau de droite');
      expect(body, `écran ${step + 1}`).not.toContain('Aucune source');
      expect(body, `écran ${step + 1}`).not.toContain('Aucune sous-question');

      const next = page.getByRole('button', { name: /^Suivant/ });
      if (!(await next.count())) break;

      const required = page.locator('input[required]:visible, textarea[required]:visible').first();
      if (await required.count()) await required.fill('audit@exemple.mu').catch(() => {});

      await next.first().click();
      await page.waitForTimeout(500);
    }

    expect(errors, 'console du parcours complet').toEqual([]);
  });

  test('un formulaire clos s’explique au lieu de planter', async ({ page }) => {
    test.skip(!SLUG, 'E2E_AUDIT_SLUG non défini');

    /**
     * Il répondait 500.
     *
     * `ClosedFormPage` est un composant SERVEUR ; il passait deux rappels vides
     * à `FormHeader`, qui est un composant client. Next refuse de sérialiser une
     * fonction à travers cette frontière, et la page échouait — pour deux
     * fonctions que l'en-tête, en mode aperçu, n'appelle jamais. Le jour où un
     * formulaire atteignait sa date de clôture, ses visiteurs recevaient une
     * erreur serveur au lieu du message rédigé par l'auteur.
     */
    const errors = watchConsole(page);

    await patchForm(page, { closes_at: new Date(Date.now() - 3_600_000).toISOString() });

    try {
      const response = await page.goto(`/f/${SLUG}`);
      expect(response?.status(), 'la page répond').toBe(200);
      await expectNoCrash(page);
      // L'apostrophe vient du message par défaut : droite ici, courbe ailleurs.
      await expect(page.locator('body')).toContainText(/n['’]accepte plus de r|ferm/i);
      expect(errors, 'console du formulaire clos').toEqual([]);
    } finally {
      await patchForm(page, { closes_at: null });
    }
  });

  test('le QR code est dessiné, pas emprunté', async ({ page }) => {
    test.skip(!PROJECT || !FORM, 'formulaire d’essai non défini');

    /**
     * Il venait d'`api.qrserver.com` et ne s'affichait jamais : la politique de
     * sécurité de contenu n'autorise `img-src` que pour nos propres domaines,
     * donc le navigateur bloquait l'image sans un mot. Il est désormais calculé
     * dans le navigateur, en `data:`.
     */
    const errors = watchConsole(page);

    await page.goto(`/projects/${PROJECT}/forms/${FORM}?tab=share`);
    await page.waitForTimeout(3000);

    const qr = page.locator('img[alt="QR code du formulaire"]');
    await expect(qr).toBeVisible({ timeout: 10_000 });
    await expect(qr).toHaveAttribute('src', /^data:image\//);

    const box = await qr.boundingBox();
    expect(box?.width ?? 0, 'le QR occupe la place prévue').toBeGreaterThan(150);

    expect(errors, 'console de l’onglet Partage').toEqual([]);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. Répondre pour de vrai, et retrouver la réponse
  // ══════════════════════════════════════════════════════════════════════════

  test('une réponse envoyée arrive dans l’onglet Réponses', async ({ page }) => {
    test.skip(!SLUG || !FORM || !PROJECT, 'formulaire d’essai non défini');
    test.setTimeout(240_000);
    await setDisplayMode(page, 'scroll');

    const errors = watchConsole(page);
    const marker = `Auditrice ${Date.now()}`;

    await page.goto(`/f/${SLUG}`);
    await page.waitForTimeout(1800);

    await page.getByLabel(/Nom complet/).fill(marker);
    await page.getByLabel(/Adresse e-mail/).fill(`audit+${Date.now()}@exemple.mu`);
    await page.getByRole('button', { name: /^Envoyer/ }).click();

    await expect(page.getByText(/merci|enregistr/i).first()).toBeVisible({ timeout: 25_000 });
    await expectNoCrash(page);

    await page.goto(`/projects/${PROJECT}/forms/${FORM}?tab=records`);
    await page.waitForTimeout(3500);
    await expectNoCrash(page);
    await expect(page.locator('body')).toContainText(marker, { timeout: 25_000 });

    expect(errors, 'console du parcours de réponse').toEqual([]);
  });
  });
});
