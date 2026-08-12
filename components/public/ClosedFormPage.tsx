import { Lock } from 'lucide-react';
import { FormHeader } from '@/components/builder/FormHeader';
import { getBackgroundStyle } from '@/lib/theme';
import type { PublicForm } from '@/lib/public-form';

/**
 * Écran affiché quand un formulaire n'accepte plus de réponses.
 *
 * Il remplace le 404 renvoyé jusqu'ici : quelqu'un qui clique sur un lien
 * d'inscription périmé mérite mieux qu'une page « introuvable », et l'auteur du
 * formulaire peut rédiger son propre message dans l'onglet Paramètres.
 *
 * Aucune question n'est rendue ici — la vue publique des champs ne les renvoie
 * de toute façon pas pour un formulaire clos.
 */
export function ClosedFormPage({ form }: { form: PublicForm }) {
  const message =
    form.settings?.closed_message_enabled && form.settings.closed_message?.trim()
      ? form.settings.closed_message.trim()
      : "Ce formulaire n'accepte plus de réponses.";

  return (
    <div
      className="min-h-screen"
      style={{ background: 'var(--papyrus-bg)', ...getBackgroundStyle(form.theme) }}
    >
      <div className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-8 py-12">
        <div className="w-full text-center">
          <FormHeader
            theme={form.theme}
            selectedElement={null}
            onSelectBanner={() => {}}
            onSelectLogo={() => {}}
            preview
          />

          <div
            className="mx-auto mb-6 mt-8 flex h-16 w-16 items-center justify-center rounded-full"
            style={{ backgroundColor: form.theme.accent || '#052139' }}
          >
            <Lock className="h-7 w-7 text-white" />
          </div>

          <h1 className="font-display text-3xl text-text-primary">{form.title}</h1>

          <p className="mt-4 whitespace-pre-line text-lg leading-relaxed text-text-secondary">
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}
