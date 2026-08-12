import type { Metadata } from 'next';
import { TEMPLATE_INDEX } from '@/lib/templates/generated';
import { TemplateGallery } from './TemplateGallery';

/**
 * Page des modèles — Server Component.
 *
 * Elle ne fait qu'une chose : lire l'index du catalogue et le passer à la
 * galerie. `generated.ts` porte `import 'server-only'`, ce qui garantit
 * structurellement que les ~600 Ko de définitions ne peuvent pas entrer dans un
 * bundle navigateur — seul l'index (~37 Ko) traverse, sérialisé dans le flux RSC.
 */
export const metadata: Metadata = { title: 'Modèles' };

export default function TemplatesPage() {
  return <TemplateGallery index={TEMPLATE_INDEX} />;
}
