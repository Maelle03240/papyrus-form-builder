import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireTeamMembership } from '@/lib/auth/form-access';
import { buildRecordsWorkbook, loadProjectFormsForExport } from '@/lib/records-server';
import { exportFilename, filterFromParams } from '@/lib/records';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Export XLSX des réponses de tous les formulaires d'un projet — un onglet
 * chacun.
 *
 * `service_role` sert à lire les formulaires et leurs réponses d'un seul tenant ;
 * l'appartenance de l'appelant à l'espace de travail du projet est vérifiée
 * avant, et le projet n'est nommé nulle part dans la réponse s'il ne l'est pas.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const { data: project } = await createAdminClient()
    .from('projects')
    .select('id, team_id, name')
    .eq('id', id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: 'Projet introuvable' }, { status: 404 });
  }

  const guard = await requireTeamMembership(project.team_id);
  if ('error' in guard) return guard.error;

  const forms = await loadProjectFormsForExport(id);
  if (forms.length === 0) {
    return NextResponse.json(
      { error: 'Ce projet ne contient aucun formulaire.' },
      { status: 404 }
    );
  }

  try {
    const { buffer } = await buildRecordsWorkbook({
      forms,
      filter: filterFromParams(request.nextUrl.searchParams),
      title: 'Réponses'
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${exportFilename(project.name)}"`,
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    console.error('Export XLSX du projet échoué:', error);
    return NextResponse.json({ error: "Le fichier n'a pas pu être produit." }, { status: 500 });
  }
}
