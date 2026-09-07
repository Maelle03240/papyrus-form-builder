import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireFormAccess } from '@/lib/auth/form-access';
import { buildSubmissionPdf } from '@/lib/pdf/submission-pdf';
import { sampleResponses } from '@/lib/email/tokens';
import type { Field, Form, LogicRule, Section } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Aperçu du document joint aux e-mails, sur des réponses d'exemple.
 *
 * Il existe parce qu'un auteur ne peut pas juger une pièce jointe qu'il n'a
 * jamais vue : sans cet aperçu, la seule façon de savoir à quoi ressemble le bon
 * de commande serait de remplir son propre formulaire en production.
 *
 * Chaque valeur est le libellé de sa question entre crochets — jamais un exemple
 * plausible, qu'on finirait par prendre pour une vraie réponse.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const guard = await requireFormAccess(id);
  if ('error' in guard) return guard.error;

  const admin = createAdminClient();
  const { data: form } = await admin
    .from('forms')
    .select('*, sections(*), fields(*), logic_rules(*), projects(name, invoice_prefix, invoice_pad)')
    .eq('id', id)
    .maybeSingle();

  if (!form) {
    return NextResponse.json({ error: 'Formulaire introuvable' }, { status: 404 });
  }

  const sections = ((form.sections ?? []) as Section[]).sort(
    (a, b) => a.section_order - b.section_order
  );
  const rank = new Map(sections.map((section) => [section.id, section.section_order]));
  const fields = ((form.fields ?? []) as Field[]).sort((a, b) => {
    const bySection =
      (rank.get(a.section_id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.section_id) ?? Number.MAX_SAFE_INTEGER);
    return bySection !== 0 ? bySection : a.field_order - b.field_order;
  });

  const project = (form as {
    projects?: { name?: string; invoice_prefix?: string; invoice_pad?: number } | null;
  }).projects;

  const complete: Form = {
    ...(form as unknown as Form),
    sections,
    fields,
    logic_rules: (form.logic_rules ?? []) as LogicRule[]
  };

  try {
    const pdf = await buildSubmissionPdf({
      form: complete,
      responses: sampleResponses(complete),
      submittedAt: new Date().toISOString(),
      projectName: project?.name,
      invoiceNumber: `${project?.invoice_prefix || 'CMD'}-${'0'.repeat(
        Math.max((project?.invoice_pad ?? 4) - 1, 0)
      )}1`
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="apercu.pdf"',
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    console.error("Génération de l'aperçu PDF échouée:", error);
    return NextResponse.json({ error: 'L’aperçu n’a pas pu être produit.' }, { status: 500 });
  }
}
