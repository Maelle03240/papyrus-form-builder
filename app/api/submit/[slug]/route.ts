import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { calculateFormScore, type FormResponses } from '@/lib/scoring';
import { sendSubmissionNotifications } from '@/lib/email/notifications';
import { syncSubmissionToSheets } from '@/lib/integrations/google-sheets-sync';
import { verifyFormAccessToken } from '@/lib/form-access';
import {
  checkDuplicateAnswer,
  checkSubmissionLimit,
  enforceDataRetention
} from '@/lib/submission-guards';
import type { Field, Form, FormSettings } from '@/types';

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

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
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
      'id, team_id, created_by, title, slug, status, closes_at, access_type, unique_email, scoring_enabled, theme, settings, notification_settings, fields(*)'
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

  // 5. Quota de réponses fixé par l'auteur.
  const limitFailure = await checkSubmissionLimit(form.id, settings);
  if (limitFailure) {
    return NextResponse.json({ error: limitFailure.error }, { status: limitFailure.status });
  }

  // 6. Ne conserver que les réponses correspondant à un champ existant.
  //    Sans ce filtre, n'importe quelle clé envoyée par le client finissait
  //    telle quelle dans la colonne JSONB.
  const answerableFields = fields.filter(
    (f) => !['section_break', 'statement', 'image', 'video'].includes(f.type)
  );
  const knownFieldIds = new Set(answerableFields.map((f) => f.id));

  const responses: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(submittedResponses)) {
    // Les sous-questions utilisent la forme `champ__option__sousChamp`.
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

  // 7. Champs obligatoires.
  const missingFields = answerableFields
    .filter((f) => f.required)
    .filter((f) => {
      const value = responses[f.id];
      if (value === undefined || value === null) return true;
      if (typeof value === 'string') return value.trim() === '';
      if (Array.isArray(value)) return value.length === 0;
      return false;
    });

  if (missingFields.length > 0) {
    return NextResponse.json(
      {
        error: 'Certaines questions obligatoires sont sans réponse.',
        missingFields: missingFields.map((f) => f.label?.fr || f.id)
      },
      { status: 422 }
    );
  }

  // 8. Une ébauche déjà enregistrée pour cette session sera remplacée, pas
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

  // 9. Un seul envoi par personne, si l'option est active.
  const respondentEmail = findRespondentEmail(answerableFields, responses);

  if (form.unique_email) {
    if (!respondentEmail) {
      return NextResponse.json(
        { error: 'Une adresse email est requise pour répondre à ce formulaire.' },
        { status: 422 }
      );
    }

    const { data: existing } = await supabase
      .from('submissions')
      .select('id')
      .eq('form_id', form.id)
      .eq('is_partial', false)
      .eq('respondent_email', respondentEmail)
      .maybeSingle();

    if (existing && existing.id !== existingPartialId) {
      return NextResponse.json(
        { error: 'Une réponse a déjà été enregistrée pour cette adresse email.' },
        { status: 409 }
      );
    }
  }

  // 10. Doublon sur le champ désigné comme identifiant unique.
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

  // 11. Score recalculé côté serveur — le client ne peut pas le falsifier.
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
    session_id: sessionId
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

  // 12. Effets de bord. Aucun ne peut plus faire échouer l'envoi : la réponse
  //     est en base, le répondant a droit à sa confirmation quoi qu'il arrive
  //     du côté de Resend ou de Google.
  await runPostSubmissionEffects({
    form: { ...(form as unknown as Form), fields },
    settings,
    responses,
    submissionId: inserted.id,
    submittedAt: record.completed_at
  });

  return NextResponse.json({
    success: true,
    submission_id: inserted.id,
    ...(settings.redirect_on_completion && settings.redirect_url
      ? { redirect_url: settings.redirect_url }
      : {}),
    ...(score && { score: score.totalScore, max_score: score.maxScore })
  });
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
