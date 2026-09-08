import { NextResponse, type NextRequest } from 'next/server';
import { requireFormAccess } from '@/lib/auth/form-access';
import { buildRecordsWorkbook, loadFormForExport } from '@/lib/records-server';
import { exportFilename, filterFromParams } from '@/lib/records';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Export XLSX des réponses d'un formulaire.
 *
 * Le filtre voyage dans l'URL et est réappliqué ici : le fichier contient
 * exactement les lignes que l'écran montrait. Exporter « tout » quand l'écran
 * affiche « les payées de septembre » est le genre d'écart qu'on ne remarque
 * qu'après avoir envoyé le fichier à quelqu'un.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const guard = await requireFormAccess(id);
  if ('error' in guard) return guard.error;

  const form = await loadFormForExport(id);
  if (!form) {
    return NextResponse.json({ error: 'Formulaire introuvable' }, { status: 404 });
  }

  try {
    const { buffer } = await buildRecordsWorkbook({
      forms: [form],
      filter: filterFromParams(request.nextUrl.searchParams),
      title: 'Réponses'
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${exportFilename(form.title)}"`,
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    console.error('Export XLSX échoué:', error);
    return NextResponse.json({ error: "Le fichier n'a pas pu être produit." }, { status: 500 });
  }
}
