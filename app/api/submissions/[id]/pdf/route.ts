import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireFormAccess } from '@/lib/auth/form-access';
import { buildSubmissionPdf } from '@/lib/pdf/submission-pdf';
import type { Field, Form, LogicRule, Section, TotalsSnapshot } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Le PDF d'une réponse — le même document que la pièce jointe de l'e-mail.
 *
 * Il est régénéré à la demande plutôt que stocké : les réponses et les totaux
 * sont figés en base, donc le document l'est aussi, et un fichier de plus par
 * réponse n'apporterait qu'un objet à sauvegarder et à purger.
 *
 * `service_role` sert à lire la réponse et son formulaire d'un seul tenant : les
 * droits de l'appelant sont vérifiés avant, par `requireFormAccess`.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const admin = createAdminClient();

  const { data: submission } = await admin
    .from('submissions')
    .select('id, form_id, responses, completed_at, pricing, invoice_number, is_partial')
    .eq('id', id)
    .maybeSingle();

  if (!submission) {
    return NextResponse.json({ error: 'Réponse introuvable' }, { status: 404 });
  }

  // La garde vient après la lecture parce qu'elle a besoin du formulaire, mais
  // rien n'a encore été divulgué : seul le PDF, produit plus bas, l'est.
  const guard = await requireFormAccess(submission.form_id);
  if ('error' in guard) return guard.error;

  const { data: form } = await admin
    .from('forms')
    .select('*, sections(*), fields(*), logic_rules(*), projects(name)')
    .eq('id', submission.form_id)
    .maybeSingle();

  if (!form) {
    return NextResponse.json({ error: 'Formulaire introuvable' }, { status: 404 });
  }

  const sections = ((form.sections ?? []) as Section[]).sort(
    (a, b) => a.section_order - b.section_order
  );

  // `field_order` est relatif à sa section : trier sur ce seul critère
  // entrelacerait les sections, et le document présenterait les questions dans
  // un ordre que personne n'a jamais vu à l'écran.
  const rank = new Map(sections.map((section) => [section.id, section.section_order]));
  const fields = ((form.fields ?? []) as Field[]).sort((a, b) => {
    const bySection =
      (rank.get(a.section_id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.section_id) ?? Number.MAX_SAFE_INTEGER);
    return bySection !== 0 ? bySection : a.field_order - b.field_order;
  });

  try {
    const pdf = await buildSubmissionPdf({
      form: {
        ...(form as unknown as Form),
        sections,
        fields,
        logic_rules: (form.logic_rules ?? []) as LogicRule[]
      },
      responses: (submission.responses ?? {}) as Record<string, unknown>,
      submittedAt: submission.completed_at,
      invoiceNumber: submission.invoice_number,
      projectName: (form as { projects?: { name?: string } | null }).projects?.name,
      pricing: submission.pricing as TotalsSnapshot | null
    });

    const filename = `${submission.invoice_number || `reponse-${submission.id.slice(0, 8)}`}.pdf`;

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        // `inline` : le navigateur l'ouvre dans un onglet. Forcer le
        // téléchargement obligerait à ouvrir un fichier pour un simple coup d'œil.
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    console.error('Génération du PDF échouée:', error);
    return NextResponse.json({ error: 'Le document n’a pas pu être produit.' }, { status: 500 });
  }
}
