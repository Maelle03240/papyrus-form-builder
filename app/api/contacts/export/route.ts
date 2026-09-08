import { NextResponse, type NextRequest } from 'next/server';

import { createAdminClient } from '@/lib/supabase/server';
import { requireTeamMembership } from '@/lib/auth/form-access';
import { buildWorkbook } from '@/lib/xlsx';
import { exportFilename } from '@/lib/records';
import type { Contact } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Export XLSX du carnet d'adresses d'un espace de travail.
 *
 * Comme l'export des réponses en phase 5 : le filtre voyage en paramètre d'URL
 * et le fichier est bâti côté serveur, plutôt que de sérialiser ce que la page
 * a chargé. Les deux divergent dès qu'une liste pagine, et on ne s'en aperçoit
 * qu'après avoir envoyé le fichier à quelqu'un.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const teamId = params.get('team');

  if (!teamId) {
    return NextResponse.json({ error: 'Espace de travail manquant.' }, { status: 400 });
  }

  const guard = await requireTeamMembership(teamId);
  if ('error' in guard) return guard.error;

  const admin = createAdminClient();

  let query = admin
    .from('contacts')
    .select('*')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false });

  const projectId = params.get('project');
  if (projectId) query = query.eq('project_id', projectId);

  const search = (params.get('q') ?? '').trim();
  if (search) {
    // Échappé : une virgule non protégée couperait le filtre PostgREST en deux
    // conditions, et un `%` saisi par l'utilisateur élargirait la recherche à
    // tout le carnet au lieu de la restreindre.
    const safe = search.replace(/[%,()]/g, ' ');
    query = query.or(
      `name.ilike.%${safe}%,email.ilike.%${safe}%,company.ilike.%${safe}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error('Lecture des contacts échouée:', error);
    return NextResponse.json({ error: "Les contacts n'ont pas pu être lus." }, { status: 500 });
  }

  const contacts = (data ?? []) as Contact[];

  if (contacts.length === 0) {
    return NextResponse.json({ error: 'Aucun contact à exporter.' }, { status: 404 });
  }

  try {
    const buffer = await buildWorkbook([
      {
        name: 'Contacts',
        headers: ['Nom', 'E-mail', 'Téléphone', 'Société', 'Projet', 'Langue', 'Notes', 'Ajouté le'],
        rows: contacts.map((contact) => [
          contact.name,
          contact.email,
          contact.phone,
          contact.company,
          contact.project_name,
          contact.language,
          contact.notes,
          contact.created_at.slice(0, 10)
        ])
      }
    ]);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${exportFilename('contacts')}"`,
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (exportError) {
    console.error('Export XLSX des contacts échoué:', exportError);
    return NextResponse.json({ error: "Le fichier n'a pas pu être produit." }, { status: 500 });
  }
}
