import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTeamMembership } from '@/lib/auth/form-access';
import { getAccessTokenForTeam } from '@/lib/google/credentials';
import { GoogleApiError } from '@/lib/google/oauth';
import {
  createSpreadsheet,
  getSpreadsheet,
  listSpreadsheets,
  parseSpreadsheetId
} from '@/lib/google/sheets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Traduit une erreur Google en réponse HTTP, sans divulguer de détail interne. */
function toResponse(error: unknown) {
  if (error instanceof GoogleApiError) {
    return NextResponse.json(
      { error: error.message, needsReconnect: error.needsReconnect },
      { status: error.status === 401 ? 401 : error.status >= 500 ? 502 : error.status }
    );
  }
  console.error('Erreur Google Sheets:', error);
  return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
}

/** Feuilles de calcul accessibles à Papyrus pour cet espace de travail. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamId = url.searchParams.get('teamId');
  const lookup = url.searchParams.get('lookup');

  if (!teamId) {
    return NextResponse.json({ error: 'Paramètre teamId manquant' }, { status: 400 });
  }

  const guard = await requireTeamMembership(teamId);
  if ('error' in guard) return guard.error;

  try {
    const accessToken = await getAccessTokenForTeam(teamId);

    // `lookup` = rattacher une feuille existante à partir de son URL.
    if (lookup) {
      const spreadsheetId = parseSpreadsheetId(lookup);
      if (!spreadsheetId) {
        return NextResponse.json(
          { error: "Ce lien ne ressemble pas à une URL Google Sheets." },
          { status: 400 }
        );
      }
      const details = await getSpreadsheet(accessToken, spreadsheetId);
      return NextResponse.json({ spreadsheet: details });
    }

    return NextResponse.json({ spreadsheets: await listSpreadsheets(accessToken) });
  } catch (error) {
    return toResponse(error);
  }
}

const CreateSchema = z.object({
  teamId: z.string().uuid(),
  title: z.string().min(1).max(200),
  sheetTitle: z.string().min(1).max(100).default('Réponses')
});

/** Crée une feuille de calcul dans le Drive du compte connecté. */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 });
  }

  const guard = await requireTeamMembership(parsed.data.teamId);
  if ('error' in guard) return guard.error;

  try {
    const accessToken = await getAccessTokenForTeam(parsed.data.teamId);
    const spreadsheet = await createSpreadsheet(
      accessToken,
      parsed.data.title,
      parsed.data.sheetTitle
    );
    return NextResponse.json({ spreadsheet });
  } catch (error) {
    return toResponse(error);
  }
}
