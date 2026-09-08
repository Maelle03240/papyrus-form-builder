import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { calculateFormScore, type FormResponses } from '@/lib/scoring';
import { sendSubmissionNotifications } from '@/lib/email/notifications';
import { sendConfirmationEmail } from '@/lib/email/confirmation';
import { syncSubmissionToSheets } from '@/lib/integrations/google-sheets-sync';
import { verifyFormAccessToken } from '@/lib/form-access';
import { evaluateFormVisibility } from '@/lib/visibility';
import { applyCalculatedFields } from '@/lib/calculated';
import { computeTotals, resolvePricing, resolveTier } from '@/lib/pricing';
import { canBeRequired, isAnswerable, isAnswerEmpty } from '@/lib/submission-format';
import {
  checkDuplicateAnswer,
  checkSubmissionLimit,
  enforceDataRetention
} from '@/lib/submission-guards';
import { DISCOUNT_CODE_KEY } from '@/types';
import type {
  Field,
  Form,
  FormSettings,
  LogicRule,
  ProjectModules,
  Section,
  TotalsSnapshot
} from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Réception d'une réponse publique.
 *
 * C'est le seul chemin d'écriture vers `submissions` : la policy RLS qui
 * autorisait l'insertion anonyme directe a été retirée (migration 012). Tout
 * passe donc par ici, où l'on peut réellement valider et limiter.
 *
 * Contrôles appliqués :
 *  · rate limit par IP et par formulaire ;
 *  · taille maximale du corps ;
 *  · formulaire réellement publié et non expiré ;
 *  · quota de réponses, si l'auteur en a fixé un ;
 *  · champs obligatoires présents ;
 *  · réponses filtrées sur les champs qui existent vraiment (une clé inconnue
 *    ne peut plus être écrite en base) ;
 *  · unicité par email si `unique_email` est activé, ou sur le champ désigné si
 *    l'option « empêcher les doublons » l'est ;
 *  · IP hachée avec un sel d'instance, jamais stockée en clair.
 *
 * Après enregistrement, trois effets de bord qui ne doivent JAMAIS faire échouer
 * l'envoi : notifications email, synchronisation Google Sheets, purge de
 * rétention. Ils sont exécutés après la réponse HTTP.
 */

/** Taille maximale d'une soumission — au-delà, c'est un abus, pas un formulaire. */
const MAX_BODY_BYTES = 512 * 1024; // 512 Ko

/** Longueur maximale d'une réponse texte unitaire. */
const MAX_ANSWER_LENGTH = 10_000;

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const params = await context.params;
  const { slug } = params;
  const ip = clientIp(request.headers);

  // 1. Rate limit : 10 envois par minute et par IP sur un même formulaire.
  const limit = rateLimit(`submit:${slug}:${ip}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Trop de tentatives. Réessayez dans un instant.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  // 2. Corps de requête — refus au-delà de la taille limite.
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Réponse trop volumineuse.' }, { status: 413 });
  }

  let body: {
    responses?: Record<string, unknown>;
    language?: string;
    sessionId?: string;
    accessToken?: string;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const submittedResponses = body.responses;
  if (!submittedResponses || typeof submittedResponses !== 'object' || Array.isArray(submittedResponses)) {
    return NextResponse.json({ error: 'Réponses manquantes ou invalides.' }, { status: 400 });
  }

  const language = typeof body.language === 'string' ? body.language.slice(0, 10) : 'fr';
  const sessionId =
    typeof body.sessionId === 'string' && body.sessionId.length <= 100
      ? body.sessionId
      : null;

  const supabase = createAdminClient();

  // 3. Charger le formulaire et ses champs.
  const { data: form, error: formError } = await supabase
    .from('forms')
    .select(
      'id, team_id, created_by, project_id, title, slug, status, closes_at, access_type, unique_email, scoring_enabled, theme, settings, notification_settings, pricing_config, email_config, confirmation_config, sections(*), fields(*), logic_rules(*), projects(name, pricing, modules)'
    )
    .eq('slug', slug)
    .maybeSingle();

  if (formError) {
    console.error('Erreur récupération formulaire:', formError);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }

  if (!form) {
    return NextResponse.json({ error: 'Formulaire introuvable' }, { status: 404 });
  }

  if (form.status !== 'published') {
    return NextResponse.json({ error: "Ce formulaire n'accepte pas de réponses." }, { status: 403 });
  }

  if (form.closes_at && new Date(form.closes_at) < new Date()) {
    return NextResponse.json(
      { error: 'Ce formulaire est fermé aux réponses (date limite dépassée).' },
      { status: 403 }
    );
  }

  // 4. Formulaire protégé : seul un jeton délivré par /api/forms/access, donc
  //    après validation du mot de passe, autorise l'envoi. Sans ce contrôle,
  //    connaître les identifiants des champs suffirait à répondre.
  if (form.access_type === 'password' && !verifyFormAccessToken(form.id, body.accessToken)) {
    return NextResponse.json(
      { error: 'Ce formulaire est protégé. Saisissez le mot de passe pour répondre.' },
      { status: 401 }
    );
  }

  const settings: FormSettings = (form.settings ?? {}) as FormSettings;
  const fields: Field[] = form.fields ?? [];
  // Les sections portent leur propre verrou de visibilité depuis la phase 2 :
  // sans elles, une section masquée par son auteur verrait ses questions
  // exigées à l'envoi alors que personne ne les a jamais vues.
  const sections: Section[] = form.sections ?? [];

  // 5. Quota de réponses fixé par l'auteur.
  const limitFailure = await checkSubmissionLimit(form.id, settings);
  if (limitFailure) {
    return NextResponse.json({ error: limitFailure.error }, { status: limitFailure.status });
  }

  // 6. Ne conserver que les réponses correspondant à un champ existant.
  //    Sans ce filtre, n'importe quelle clé envoyée par le client finissait
  //    telle quelle dans la colonne JSONB.
  const answerableFields = fields.filter(isAnswerable);
  const knownFieldIds = new Set(answerableFields.map((f) => f.id));

  const responses: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(submittedResponses)) {
    // Le code de réduction n'est pas une question, donc pas un champ : sans
    // cette exception, le filtre l'écarterait et aucune remise ne s'appliquerait
    // jamais côté serveur — le répondant verrait la remise à l'écran et
    // recevrait une facture au prix fort.
    if (key === DISCOUNT_CODE_KEY) {
      responses[key] = typeof value === 'string' ? value.slice(0, 64) : '';
      continue;
    }

    // Les sous-questions utilisent la forme `champ__option__sousChamp`, et les
    // compteurs de quantité `champ__qty` : la racine est le champ dans les deux
    // cas, donc ils suivent leur champ quand une branche est abandonnée.
    const rootId = key.split('__')[0];
    if (!knownFieldIds.has(rootId)) continue;

    if (typeof value === 'string') {
      responses[key] = value.slice(0, MAX_ANSWER_LENGTH);
    } else if (Array.isArray(value)) {
      responses[key] = value
        .slice(0, 200)
        .map((item) => (typeof item === 'string' ? item.slice(0, MAX_ANSWER_LENGTH) : item));
    } else {
      responses[key] = value;
    }
  }

  // 6 bis. Champs calculés, première passe.
  //
  //    Avant d'évaluer quoi que ce soit : leur valeur arrive dans la requête,
  //    puisque le répondant la voit à l'écran, mais rien n'empêche de la
  //    remplacer avant l'envoi. Si une condition d'affichage s'appuie sur un
  //    total — « à partir de 10 participants, demander la facturation » — c'est
  //    la valeur recalculée qui doit la trancher, pas celle qu'on nous annonce.
  for (const [key, value] of Object.entries(applyCalculatedFields(fields, responses))) {
    responses[key] = value;
  }

  // 7. Logique conditionnelle.
  //
  //    Le serveur l'ignorait complètement : il exigeait TOUS les champs marqués
  //    obligatoires, y compris ceux qu'une règle `show_field` garde masqués. Un
  //    répondant qui prenait la branche « non » d'une question conditionnelle
  //    voyait donc son envoi refusé pour une question qu'il n'avait jamais eue à
  //    l'écran, avec un message qui ne désignait rien de visible. Huit des
  //    cinquante modèles du catalogue sont dans ce cas.
  //
  //    C'est le MÊME évaluateur que celui du navigateur (`lib/visibility`),
  //    appelé sur les mêmes réponses : les deux ne peuvent pas diverger. Il
  //    combine les règles de logique et les verrous portés par les champs et les
  //    sections.
  const visibleFieldIds = evaluateFormVisibility(
    { fields, sections, logic_rules: (form.logic_rules ?? []) as LogicRule[] },
    responses
  ).fields;

  // Une réponse à un champ devenu invisible n'est pas une réponse : le
  // répondant est revenu en arrière et a changé de branche. La conserver la
  // ferait apparaître dans le tableau, l'export et la feuille Google comme une
  // réponse assumée.
  for (const key of Object.keys(responses)) {
    // Le code de réduction n'appartient à aucun champ : sa racine est vide, donc
    // ce filtre l'écarterait à tous les coups. La remise s'afficherait à l'écran
    // et disparaîtrait de la facture — sans erreur, et sans que rien ne le
    // laisse voir avant que le client ne s'en plaigne.
    if (key === DISCOUNT_CODE_KEY) continue;
    if (!visibleFieldIds.has(key.split('__')[0])) delete responses[key];
  }

  // 7 bis. Champs calculés, seconde passe.
  //
  //    Le masquage a pu retirer le bloc répétable qu'un total comptait : sans
  //    cette reprise, un « nombre de participants » facturé au prix unitaire
  //    resterait à la valeur d'une branche que le répondant a quittée.
  for (const [key, value] of Object.entries(
    applyCalculatedFields(
      fields.filter((f) => visibleFieldIds.has(f.id)),
      responses
    )
  )) {
    responses[key] = value;
  }

  // 8. Champs obligatoires — parmi les seuls champs réellement visibles.
  const missingFields = answerableFields
    .filter((f) => f.required && canBeRequired(f) && visibleFieldIds.has(f.id))
    .filter((f) => isAnswerEmpty(responses[f.id]));

  if (missingFields.length > 0) {
    return NextResponse.json(
      {
        error: 'Certaines questions obligatoires sont sans réponse.',
        missingFields: missingFields.map((f) => f.label?.fr || f.id)
      },
      { status: 422 }
    );
  }

  // 8 bis. Tarification.
  //
  //    Les totaux sont recalculés ici, jamais repris du client : le
  //    récapitulatif affiché au répondant est produit par la MÊME fonction, sur
  //    les mêmes réponses, mais rien n'empêche de modifier le corps de la
  //    requête avant l'envoi. Un total accepté sur parole serait un tarif
  //    négociable depuis les outils de développement.
  //
  //    Le calcul ne compte que les champs réellement visibles — `computeTotals`
  //    repose sur le même évaluateur que le rendu —, donc une option cochée puis
  //    masquée par un changement de branche ne peut pas rester facturée.
  let pricingSnapshot: TotalsSnapshot | null = null;
  const pricing = resolvePricing({
    pricing_config: (form as { pricing_config?: Form['pricing_config'] }).pricing_config,
    project_pricing: (form as { projects?: { pricing?: Form['project_pricing'] } | null }).projects
      ?.pricing
  });

  if (pricing.enabled) {
    // Le compte des inscriptions n'est lu que par les tarifs dégressifs : c'est
    // une requête de plus, inutile partout ailleurs.
    //
    // Les réponses annulées en sont exclues, exactement comme dans la vue
    // `public_forms` : le tarif affiché au répondant et celui qui lui est
    // facturé doivent sortir du même compte, sans quoi une annulation ferait
    // baisser le prix annoncé sans faire baisser la facture.
    let registeredCount = 0;
    if (pricing.tiered?.enabled) {
      const { count } = await supabase
        .from('submissions')
        .select('id', { count: 'exact', head: true })
        .eq('form_id', form.id)
        .eq('is_partial', false)
        .neq('status', 'void');
      registeredCount = count ?? 0;

      // Inscriptions closes : le dernier palier est dépassé et l'auteur a
      // demandé la fermeture. Le formulaire public le dit déjà, mais un onglet
      // resté ouvert depuis une heure ne le sait pas.
      const tier = resolveTier(pricing.tiered, registeredCount);
      if (tier.closed) {
        return NextResponse.json(
          { error: 'Les inscriptions sont closes pour ce formulaire.' },
          { status: 403 }
        );
      }
    }

    pricingSnapshot = computeTotals(
      { fields, sections, logic_rules: (form.logic_rules ?? []) as LogicRule[] },
      responses,
      pricing,
      registeredCount
    );
  }

  // 9. Une ébauche déjà enregistrée pour cette session sera remplacée, pas
  //    dupliquée : elle doit donc être exclue des contrôles d'unicité.
  let existingPartialId: string | null = null;
  if (sessionId) {
    const { data: existingPartial } = await supabase
      .from('submissions')
      .select('id, is_partial')
      .eq('form_id', form.id)
      .eq('session_id', sessionId)
      .maybeSingle();

    if (existingPartial?.is_partial) existingPartialId = existingPartial.id;
  }

  // 10. Un seul envoi par personne, si l'option est active.
  const respondentEmail = findRespondentEmail(answerableFields, responses);

  if (form.unique_email) {
    if (!respondentEmail) {
      return NextResponse.json(
        { error: 'Une adresse email est requise pour répondre à ce formulaire.' },
        { status: 422 }
      );
    }

    // Une inscription annulée ne condamne pas l'adresse : sans cela, annuler
    // puis se réinscrire serait impossible, et le message parlerait d'une
    // réponse que l'auteur a justement retirée.
    const { data: existing } = await supabase
      .from('submissions')
      .select('id')
      .eq('form_id', form.id)
      .eq('is_partial', false)
      .neq('status', 'void')
      .eq('respondent_email', respondentEmail)
      .maybeSingle();

    if (existing && existing.id !== existingPartialId) {
      return NextResponse.json(
        { error: 'Une réponse a déjà été enregistrée pour cette adresse email.' },
        { status: 409 }
      );
    }
  }

  // 11. Doublon sur le champ désigné comme identifiant unique.
  const duplicateFailure = await checkDuplicateAnswer(
    form as unknown as Form,
    answerableFields,
    responses,
    settings,
    existingPartialId ?? undefined
  );
  if (duplicateFailure) {
    return NextResponse.json({ error: duplicateFailure.error }, { status: duplicateFailure.status });
  }

  // 12. Score recalculé côté serveur — le client ne peut pas le falsifier.
  const score = form.scoring_enabled
    ? calculateFormScore({ ...(form as unknown as Form), fields }, responses as FormResponses)
    : null;

  const record = {
    form_id: form.id,
    responses,
    respondent_language: language,
    respondent_email: respondentEmail,
    ip_hash: await hashIp(ip),
    user_agent: (request.headers.get('user-agent') ?? '').slice(0, 500),
    completed_at: new Date().toISOString(),
    actions_triggered: [],
    source: 'papyrus' as const,
    is_partial: false,
    session_id: sessionId,
    // Les totaux sont figés ici et ne seront jamais recalculés : c'est ce qui
    // permet de rééditer une facture six mois plus tard, avec des prix modifiés
    // entre-temps.
    pricing: pricingSnapshot
  };

  // L'ébauche devient la réponse définitive : la mettre à jour plutôt que
  // d'insérer évite de laisser une ligne partielle orpheline à côté.
  const { data: inserted, error: submitError } = existingPartialId
    ? await supabase
        .from('submissions')
        .update(record)
        .eq('id', existingPartialId)
        .select('id')
        .single()
    : await supabase.from('submissions').insert(record).select('id').single();

  if (submitError) {
    console.error('Erreur insertion soumission:', submitError);
    return NextResponse.json({ error: "Erreur lors de l'enregistrement" }, { status: 500 });
  }

  // 13. Numéro de bon de commande.
  //
  //     APRÈS l'insertion, jamais avant. mooove-invoice tire le numéro d'abord :
  //     un enregistrement qui échoue ensuite laisse un trou définitif dans une
  //     séquence censée être continue. Ici la réponse existe déjà, donc un échec
  //     ne consomme rien.
  //
  //     L'incrément lui-même est un `update ... returning` dans une fonction SQL
  //     — donc sous verrou de ligne. Deux inscriptions simultanées ne peuvent
  //     pas recevoir le même numéro.
  const project = (form as { projects?: ProjectRelation | null }).projects ?? null;
  const projectId = (form as { project_id?: string | null }).project_id ?? null;
  const invoicingOn = (project?.modules as Partial<ProjectModules> | undefined)?.invoicing === true;

  let invoiceNumber: string | null = null;
  if (invoicingOn && projectId) {
    const { data, error } = await supabase.rpc('assign_invoice_number', {
      p_submission: inserted.id,
      p_project: projectId
    });
    if (error) {
      // Sans numéro, la réponse reste valide : elle est enregistrée, et l'auteur
      // peut la retrouver. Refuser l'envoi pour un compteur serait pire.
      console.error('Attribution du numéro de bon de commande échouée:', error);
    } else {
      invoiceNumber = typeof data === 'string' ? data : null;
    }
  }

  // 14. Effets de bord. Aucun ne peut plus faire échouer l'envoi : la réponse
  //     est en base, le répondant a droit à sa confirmation quoi qu'il arrive
  //     du côté de Resend ou de Google.
  await runPostSubmissionEffects({
    form: { ...(form as unknown as Form), fields },
    settings,
    responses,
    submissionId: inserted.id,
    submittedAt: record.completed_at,
    language,
    invoiceNumber,
    projectName: project?.name ?? undefined,
    pricing: pricingSnapshot
  });

  return NextResponse.json({
    success: true,
    submission_id: inserted.id,
    ...(invoiceNumber ? { invoice_number: invoiceNumber } : {}),
    ...(settings.redirect_on_completion && settings.redirect_url
      ? { redirect_url: settings.redirect_url }
      : {}),
    ...(score && { score: score.totalScore, max_score: score.maxScore })
  });
}

/** Ce que la jointure sur `projects` ramène — et rien de plus. */
interface ProjectRelation {
  name?: string | null;
  pricing?: Form['project_pricing'];
  modules?: Partial<ProjectModules> | null;
}

/**
 * Notifications, synchronisation et purge.
 * Chaque étape est isolée : l'échec de l'une n'empêche pas les suivantes.
 */
async function runPostSubmissionEffects(params: {
  form: Form;
  settings: FormSettings;
  responses: Record<string, unknown>;
  submissionId: string;
  submittedAt: string;
  language: string;
  invoiceNumber: string | null;
  projectName?: string;
  pricing: TotalsSnapshot | null;
}): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  const notifications = params.form.notification_settings ?? {};
  if (notifications.self?.enabled || notifications.respondent?.enabled) {
    tasks.push(
      (async () => {
        const ownerEmail = await lookupOwnerEmail(params.form.created_by);
        return sendSubmissionNotifications({
          form: params.form,
          responses: params.responses,
          submittedAt: params.submittedAt,
          ownerEmail
        });
      })()
    );
  }

  // E-mail de confirmation de l'onglet « E-mails ».
  //
  // Son issue est écrite sur la réponse, succès comme échec. « Le client a-t-il
  // reçu son bon de commande ? » est la première question posée quand quelque
  // chose cloche : sans cette trace, la seule réponse possible serait d'aller
  // lire les journaux du serveur.
  if (params.form.email_config?.enabled) {
    tasks.push(
      (async () => {
        const result = await sendConfirmationEmail({
          form: params.form,
          responses: params.responses,
          submittedAt: params.submittedAt,
          language: params.language,
          invoiceNumber: params.invoiceNumber,
          projectName: params.projectName,
          pricing: params.pricing
        });

        await createAdminClient()
          .from('submissions')
          .update(
            result.sent
              ? { email_sent_at: new Date().toISOString(), email_error: null }
              : { email_error: result.reason.slice(0, 500) }
          )
          .eq('id', params.submissionId);

        if (!result.sent) {
          console.error(`E-mail de confirmation non envoyé (${params.submissionId}):`, result.reason);
        }
      })()
    );
  }

  tasks.push(syncSubmissionToSheets(params.form.id, params.submissionId));
  tasks.push(enforceDataRetention(params.form.id, params.settings));

  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Effet post-soumission échoué:', result.reason);
    }
  }
}

/** Email du créateur du formulaire — destinataire de repli des notifications internes. */
async function lookupOwnerEmail(userId?: string): Promise<string | null> {
  if (!userId) return null;
  const { data } = await createAdminClient()
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  return data?.email ?? null;
}

/** Première réponse à un champ de type email, normalisée. */
function findRespondentEmail(fields: Field[], responses: Record<string, unknown>): string | null {
  for (const field of fields) {
    if (field.type !== 'email') continue;
    const value = responses[field.id];
    if (typeof value === 'string' && value.includes('@')) {
      return value.trim().toLowerCase();
    }
  }
  return null;
}

/**
 * Hache l'IP avec un sel propre à l'instance. Le sel codé en dur d'origine
 * rendait le hachage réversible par force brute : l'espace des IPv4 se parcourt
 * en quelques minutes quand le sel est public.
 */
async function hashIp(ip: string): Promise<string | null> {
  if (!ip || ip === 'unknown') return null;

  const salt = process.env.IP_HASH_SALT?.trim();
  if (!salt) {
    // Sans sel configuré, on préfère ne rien stocker plutôt qu'un hachage faible.
    return null;
  }

  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
