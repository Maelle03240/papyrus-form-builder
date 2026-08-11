import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { decryptSecret } from '@/lib/crypto';
import { getAllSubmissions, getForm, parseFormId, TallyApiError } from '@/lib/tally/client';
import { convertForm, convertSubmissions } from '@/lib/tally/convert';
import { rateLimit } from '@/lib/rate-limit';
import { uniqueSlug } from '@/lib/utils';
import type { TallyImportResult } from '@/lib/tally/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Un import avec réponses peut demander plusieurs allers-retours vers Tally.
export const maxDuration = 120;

/**
 * Importe un formulaire Tally dans Papyrus.
 *
 * Deux entrées possibles :
 *  · `tallyFormId` — l'espace a une clé API : structure ET réponses sont importées ;
 *  · `url` — un simple lien public tally.so : seule la structure est récupérable,
 *    l'API Tally n'expose pas les réponses sans authentification.
 *
 * L'import est transactionnel du point de vue de l'utilisateur : si la
 * conversion échoue après création du formulaire, celui-ci est supprimé pour ne
 * pas laisser de coquille vide dans la liste.
 */

const BodySchema = z.object({
  teamId: z.string().uuid(),
  /** Identifiant Tally, ou URL publique / d'édition. */
  source: z.string().min(1).max(500),
  importResponses: z.boolean().default(true)
});

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  // Un import déclenche de nombreux appels sortants : on borne la cadence.
  const limit = rateLimit(`tally-import:${user.id}`, 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Trop d’imports lancés. Patientez une minute.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 });
  }

  const { teamId, source, importResponses } = parsed.data;
  const admin = createAdminClient();

  // Droits : lecteur exclu, il ne doit pas pouvoir créer de formulaire.
  const { data: membership } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership || membership.role === 'reader') {
    return NextResponse.json({ error: 'Droits insuffisants' }, { status: 403 });
  }

  const tallyFormId = parseFormId(source);
  if (!tallyFormId) {
    return NextResponse.json(
      { error: 'Lien Tally non reconnu. Collez une URL tally.so ou un identifiant de formulaire.' },
      { status: 400 }
    );
  }

  const { data: credentials } = await admin
    .from('tally_credentials')
    .select('encrypted_api_key')
    .eq('team_id', teamId)
    .maybeSingle();

  if (!credentials) {
    return NextResponse.json(
      {
        error:
          "Aucune clé API Tally enregistrée pour cet espace. Ajoutez-la dans Paramètres › Intégrations pour importer un formulaire et ses réponses."
      },
      { status: 412 }
    );
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(credentials.encrypted_api_key);
  } catch {
    return NextResponse.json(
      { error: 'La clé Tally enregistrée est illisible. Reconnectez Tally.' },
      { status: 409 }
    );
  }

  const warnings: string[] = [];
  let createdFormId: string | null = null;

  try {
    // 1. Structure du formulaire.
    const detail = await getForm(apiKey, tallyFormId);

    // 2. Créer la coquille Papyrus pour disposer d'un identifiant de formulaire.
    const { data: form, error: formError } = await admin
      .from('forms')
      .insert({
        team_id: teamId,
        created_by: user.id,
        title: detail.name || 'Formulaire importé de Tally',
        slug: uniqueSlug(detail.name || 'formulaire-tally'),
        description: 'Importé depuis Tally',
        display_mode: 'sections',
        status: 'draft',
        access_type: 'public',
        languages: ['fr'],
        default_language: 'fr'
      })
      .select('id, title, slug')
      .single();

    if (formError || !form) throw formError ?? new Error('form_insert_failed');
    createdFormId = form.id;

    // 3. Convertir et insérer les champs.
    const converted = convertForm(detail, form.id);
    warnings.push(...converted.warnings);

    if (converted.fields.length > 0) {
      const { error: fieldsError } = await admin.from('fields').insert(
        converted.fields.map((field) => ({
          id: field.id,
          form_id: form.id,
          type: field.type,
          label: field.label,
          description: field.description,
          placeholder: field.placeholder,
          options: field.options,
          rows: field.rows ?? null,
          required: field.required,
          field_order: field.field_order,
          validation: field.validation
        }))
      );

      if (fieldsError) throw fieldsError;
    }

    // 4. Réponses — uniquement si demandé.
    let responsesImported = 0;

    if (importResponses) {
      const { pages, truncated } = await getAllSubmissions(apiKey, tallyFormId);
      if (truncated) {
        warnings.push(
          'Import limité aux 5 000 réponses les plus récentes. Relancez un import pour la suite si nécessaire.'
        );
      }

      const submissions = convertSubmissions(pages, converted.fieldIdByTallyId, converted.fields);

      if (submissions.length > 0) {
        // Par lots : une insertion de plusieurs milliers de lignes d'un coup
        // dépasse la limite de taille de requête PostgREST.
        const BATCH_SIZE = 500;
        for (let i = 0; i < submissions.length; i += BATCH_SIZE) {
          const batch = submissions.slice(i, i + BATCH_SIZE);
          const { error: insertError } = await admin.from('submissions').insert(
            batch.map((submission) => ({
              form_id: form.id,
              responses: submission.responses,
              respondent_language: 'fr',
              completed_at: submission.submittedAt,
              actions_triggered: [],
              source: 'tally_import',
              external_id: submission.externalId
            }))
          );

          if (insertError) {
            warnings.push(
              `Certaines réponses n'ont pas pu être importées (lot ${Math.floor(i / BATCH_SIZE) + 1}).`
            );
            break;
          }

          responsesImported += batch.length;
        }
      }
    }

    // 5. Journaliser l'import.
    await admin.from('tally_imports').insert({
      team_id: teamId,
      form_id: form.id,
      tally_form_id: tallyFormId,
      tally_form_name: detail.name,
      imported_by: user.id,
      fields_imported: converted.fields.length,
      responses_imported: responsesImported,
      status: warnings.length > 1 ? 'partial' : 'success'
    });

    const result: TallyImportResult = {
      formId: form.id,
      formTitle: form.title,
      fieldsImported: converted.fields.length,
      responsesImported,
      warnings
    };

    return NextResponse.json(result);
  } catch (error) {
    // Ne pas laisser un formulaire à moitié importé dans la liste.
    if (createdFormId) {
      await admin.from('forms').delete().eq('id', createdFormId);
    }

    await admin.from('tally_imports').insert({
      team_id: teamId,
      tally_form_id: tallyFormId,
      imported_by: user.id,
      status: 'failed',
      error_message: error instanceof Error ? error.message.slice(0, 500) : 'unknown'
    });

    if (error instanceof TallyApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status === 429 ? 429 : 400 });
    }

    console.error('Erreur import Tally:', error);
    return NextResponse.json(
      { error: "L'import a échoué. Aucun formulaire n'a été créé." },
      { status: 500 }
    );
  }
}
