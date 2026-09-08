import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireTeamMembership } from '@/lib/auth/form-access';
import { readAiSettings, writeAiSettings } from '@/lib/ai/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Les réglages de l'assistant d'un espace de travail.
 *
 * Route serveur obligatoire, et non lecture directe sous RLS : la table
 * `ai_settings` ne porte AUCUNE policy, exactement comme `tally_credentials`.
 * La clé d'API d'une équipe n'a aucune raison d'atteindre un navigateur, fût-ce
 * chiffrée — ce que la lecture renvoie ici est recopié champ par champ, et la
 * clé n'y figure pas, seulement son empreinte « sk-…a3f9 ».
 */

const PatchSchema = z.object({
  api_key: z.string().max(300).optional(),
  enabled: z.boolean().optional(),
  model: z.string().max(80).optional(),
  monthly_budget_usd: z.number().min(0).max(100_000).nullable().optional(),
  price_input_per_mtok: z.number().min(0).max(10_000).optional(),
  price_output_per_mtok: z.number().min(0).max(10_000).optional()
});

export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get('team');
  if (!teamId) {
    return NextResponse.json({ error: 'Espace de travail manquant.' }, { status: 400 });
  }

  const guard = await requireTeamMembership(teamId);
  if ('error' in guard) return guard.error;

  return NextResponse.json(await readAiSettings(teamId));
}

export async function PATCH(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get('team');
  if (!teamId) {
    return NextResponse.json({ error: 'Espace de travail manquant.' }, { status: 400 });
  }

  const guard = await requireTeamMembership(teamId);
  if ('error' in guard) return guard.error;

  // Seul un administrateur touche à la clé et au budget : ce sont des réglages
  // qui engagent de l'argent, et « membre de l'équipe » suffit à construire un
  // formulaire, pas à dépenser.
  if (guard.role !== 'admin') {
    return NextResponse.json(
      { error: 'Seul un administrateur de l’espace peut modifier ces réglages.' },
      { status: 403 }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Réglages invalides.' }, { status: 400 });
  }

  try {
    await writeAiSettings(teamId, guard.userId, parsed.data);
  } catch (error) {
    // Le cas concret : `APP_ENCRYPTION_KEY` absente de l'environnement. Sans
    // elle, `encryptSecret` lève — et enregistrer la clé en clair « pour
    // dépanner » serait exactement le contraire de ce que cette table protège.
    console.error('Enregistrement des réglages IA échoué:', error);
    return NextResponse.json(
      {
        error:
          'Les réglages n’ont pas pu être enregistrés. Le chiffrement des secrets n’est peut-être pas configuré sur cette instance.'
      },
      { status: 500 }
    );
  }

  return NextResponse.json(await readAiSettings(teamId));
}
