'use client';

import { useState, useEffect, useMemo } from 'react';
import type { Form } from '@/types';
import { toast } from '@/components/ui/Toast';
import { FormSlugProvider } from '@/lib/hooks/useFormSlug';
import { useFormScore } from '@/lib/hooks/useFormScore';
import { useEmbedBridge } from '@/lib/hooks/useEmbedBridge';
import { usePartialSubmission } from '@/lib/hooks/usePartialSubmission';
import { evaluateFormVisibility } from '@/lib/visibility';
import { PARTNER_CODE_PARAM } from '@/lib/partners';
import { getBackgroundStyle } from '@/lib/theme';
import { canBeRequired, isAnswerEmpty } from '@/lib/submission-format';
import { isVisibleToRespondent } from '@/lib/public-fields';
import type { EmbedOptions } from '@/lib/embed';
import {} from '@/components/builder/FormHeader';
import { PublicScrollView } from './PublicScrollView';
import { PublicTypeformView } from './PublicTypeformView';
import { PublicSectionsView } from './PublicSectionsView';
import { FormProgressBar } from './FormProgressBar';
import { ThankYouPage } from './ThankYouPage';

interface Props {
  form: Form;
  /** Présent uniquement quand le formulaire est rendu dans une iframe (/embed/[slug]). */
  embed?: EmbedOptions;
  /**
   * Jeton délivré par `/api/forms/access` après validation du mot de passe.
   * Joint à l'envoi : sans lui, un formulaire protégé refuse la soumission.
   */
  accessToken?: string;
  /**
   * L'aperçu du constructeur.
   *
   * Le même composant, aux deux endroits : c'est tout l'intérêt. L'aperçu
   * dupliquait auparavant les trois vues, et les deux copies avaient divergé —
   * l'aperçu évaluait la visibilité avec les seules règles de logique, quand la
   * vraie page y ajoutait les verrous de champ. Un formulaire pouvait donc
   * s'afficher correctement à l'auteur et masquer une question au répondant.
   *
   * Ce que ce drapeau change, et rien d'autre : on n'envoie pas, on
   * n'enregistre pas de réponse partielle.
   */
  preview?: boolean;
  /**
   * Force la mise en page téléphone — le cadre étroit de l'aperçu.
   *
   * Les points de rupture CSS regardent la fenêtre, pas le cadre : sans ce
   * drapeau, le cadre téléphone de l'aperçu afficherait la mise en page bureau.
   */
  mobile?: boolean;
}

export function FormPublicView({ form, embed, accessToken, preview, mobile }: Props) {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const settings = form.settings ?? {};
  const language = form.default_language || 'fr';

  // Hook pour gérer le scoring en temps réel
  const {
    responses,
    scoreResult,
    updateResponse,
    showScoreToRespondent
  } = useFormScore(form);

  // Dialogue avec la page hôte quand le formulaire est intégré ailleurs
  const { emit } = useEmbedBridge(embed ?? null);

  // Enregistrement des réponses partielles, si l'auteur l'a activé
  const partial = usePartialSubmission({
    // Un aperçu n'enregistre rien : l'auteur qui essaie son propre formulaire
    // ne doit pas apparaître dans ses réponses en cours.
    enabled: settings.partial_submissions === true && !preview,
    formId: form.id,
    slug: form.slug,
    language,
    responses,
    accessToken
  });

  // États pour la logique conditionnelle
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());

  // Évaluer la visibilité (changement de réponses, de structure ou de règles).
  //
  // `evaluateFormVisibility` combine les règles de logique et les verrous portés
  // par les champs et les sections. C'est exactement la fonction qu'appelle
  // `/api/submit/[slug]` : les deux ne peuvent pas diverger, donc aucun champ
  // masqué ici ne peut être exigé là-bas.
  useEffect(() => {
    setVisibleFields(
      evaluateFormVisibility(
        { fields: form.fields, sections: form.sections, logic_rules: form.logic_rules },
        responses
      ).fields
    );
  }, [responses, form.logic_rules, form.fields, form.sections]);

  /**
   * Pré-remplissage des champs cachés depuis la chaîne de requête.
   *
   * `?utm_source=linkedin` renseigne le champ dont la clé est `utm_source`.
   * C'est ainsi qu'une réponse se rattache à sa campagne, à son partenaire ou à
   * son canal sans qu'on ait rien à demander au répondant.
   *
   * L'effet ne s'exécute qu'au montage et ne touche qu'aux champs cachés : il ne
   * peut donc pas écraser une réponse saisie.
   */
  useEffect(() => {
    const hiddenFields = (form.fields ?? []).filter((field) => field.type === 'hidden');
    if (hiddenFields.length === 0) return;

    const query = new URLSearchParams(window.location.search);

    for (const field of hiddenFields) {
      const key = field.validation?.hidden_key;
      const fromUrl = key ? query.get(key) : null;
      const value = fromUrl ?? field.validation?.hidden_default ?? '';
      if (value !== '') updateResponse(field.id, value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.id]);

  useEffect(() => {
    emit('form-loaded', { formId: form.id, slug: form.slug });
  }, [emit, form.id, form.slug]);

  /**
   * Le code du partenaire qui a amené ce visiteur, lu dans l'URL.
   *
   * Relu à l'envoi et non conservé en état : le paramètre survit à la
   * navigation interne du formulaire, alors qu'un état perdu par un
   * rafraîchissement de page ferait disparaître l'attribution sans que
   * personne s'en aperçoive avant le calcul des commissions.
   *
   * Le serveur revérifie que ce code appartient bien au projet du formulaire :
   * ce qui arrive d'ici est une indication, jamais une autorisation.
   */
  const readPartnerCode = (): string | null => {
    if (typeof window === 'undefined') return null;
    const value = new URLSearchParams(window.location.search).get(PARTNER_CODE_PARAM);
    return value && value.length <= 60 ? value : null;
  };

  // Soumission du formulaire
  const handleSubmit = async () => {
    if (isSubmitting) return;

    // L'aperçu va jusqu'au bout — écran de remerciement compris, parce que
    // c'est aussi ce que l'auteur veut voir — mais rien ne part.
    if (preview) {
      toast.success('Aperçu : le formulaire n’a pas été envoyé.');
      setIsSubmitted(true);
      return;
    }

    setIsSubmitting(true);

    const partnerCode = readPartnerCode();

    try {
      const response = await fetch(`/api/submit/${form.slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responses,
          language,
          ...(partial.sessionId ? { sessionId: partial.sessionId } : {}),
          ...(accessToken ? { accessToken } : {}),
          ...(partnerCode ? { partnerCode } : {})
        })
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        // Le serveur renvoie un message exploitable (champ manquant, formulaire
        // fermé, quota atteint…) : l'afficher plutôt qu'une erreur générique.
        throw new Error(
          body?.error ??
            (response.status === 429
              ? 'Trop de tentatives. Patientez quelques instants avant de réessayer.'
              : "Une erreur est survenue lors de l'envoi. Veuillez réessayer.")
        );
      }

      // Nettoyer la sauvegarde locale du save & resume si activé
      if (form.save_and_resume) {
        localStorage.removeItem(`papyrus-progress-${form.id}`);
      }
      partial.clear();

      emit('form-submitted', { formId: form.id, slug: form.slug });

      // Redirection demandée par l'auteur du formulaire. L'URL vient de la vue
      // publique, donc du formulaire lui-même — mais on refuse tout de même les
      // schémas exotiques : un `javascript:` enregistré en base s'exécuterait
      // ici dans le navigateur du répondant.
      const redirectUrl = safeRedirectUrl(
        settings.redirect_on_completion ? body?.redirect_url ?? settings.redirect_url : null
      );

      if (redirectUrl) {
        // Une iframe ne doit pas détourner la page qui l'héberge : en mode
        // intégré, la redirection s'ouvre dans un nouvel onglet.
        if (embed?.enabled) window.open(redirectUrl, '_blank', 'noopener');
        else window.location.href = redirectUrl;
        return;
      }

      setSubmissionId(body?.submission_id ?? null);
      setInvoiceNumber(typeof body?.invoice_number === 'string' ? body.invoice_number : null);
      setIsSubmitted(true);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Une erreur est survenue lors de l'envoi. Veuillez réessayer.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Validation des champs requis.
   *
   * Utilise `isAnswerEmpty`, la même règle que le serveur. La version
   * précédente testait `!responses[f.id]`, ce qui déclarait vide la réponse
   * `0` — sur une échelle de notation commençant à zéro, le répondant le plus
   * critique se voyait refuser l'envoi. Douze modèles du catalogue ont une
   * échelle obligatoire de ce type.
   */
  const validateRequiredFields = () => {
    const fields = form.fields || [];
    // La même règle que `/api/submit/[slug]` : une question qui n'a pas été
    // posée ne peut pas être exigée. Les deux listes doivent coïncider, sans
    // quoi l'écran réclame un champ que le serveur ignore, ou l'inverse.
    const visibleRequiredFields = fields.filter(
      (f) =>
        f.required && visibleFields.has(f.id) && canBeRequired(f) && isVisibleToRespondent(f)
    );

    const missingFields = visibleRequiredFields.filter((f) => isAnswerEmpty(responses[f.id]));

    return { isValid: missingFields.length === 0, missingFields };
  };

  // Propage l'accent du formulaire via CSS variables
  const accentStyle = { '--accent': form.theme.accent } as React.CSSProperties;

  // En mode intégré, l'arrière-plan du thème peut être remplacé par la couleur
  // de la page hôte, et la hauteur ne doit pas être forcée à celle de l'écran.
  const containerStyle = useMemo(() => {
    if (embed?.transparentBackground) {
      return { ...accentStyle, background: 'transparent' } as React.CSSProperties;
    }
    return {
      background: 'var(--papyrus-bg)',
      ...accentStyle,
      ...getBackgroundStyle(form.theme)
    } as React.CSSProperties;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed?.transparentBackground, form.theme]);

  const viewProps = {
    form,
    responses,
    updateResponse,
    visibleFields,
    onSubmit: handleSubmit,
    isSubmitting,
    validateRequiredFields,
    scoreResult: scoreResult || undefined,
    showScoreToRespondent,
    embed,
    mobile
  };

  // Page de remerciement après soumission
  if (isSubmitted) {
    return (
      <ThankYouPage
        form={form}
        submissionId={submissionId}
        invoiceNumber={invoiceNumber}
        responses={responses}
        scoreResult={showScoreToRespondent ? (scoreResult || undefined) : undefined}
        embed={embed}
      />
    );
  }

  return (
    <FormSlugProvider slug={form.slug}>
    <div className={embed?.enabled ? 'w-full' : 'min-h-screen'} style={containerStyle}>
      {settings.progress_bar && (
        <FormProgressBar form={form} responses={responses} visibleFields={visibleFields} />
      )}

      {/* Mode d'affichage selon form.display_mode */}
      {form.display_mode === 'typeform' ? (
        <PublicTypeformView {...viewProps} />
      ) : form.display_mode === 'sections' ? (
        <PublicSectionsView {...viewProps} />
      ) : (
        <PublicScrollView {...viewProps} />
      )}
    </div>
    </FormSlugProvider>
  );
}

/**
 * N'autorise que `http` et `https` pour la redirection de fin.
 * L'URL est saisie par l'auteur du formulaire, mais elle est exécutée dans le
 * navigateur du répondant : un `javascript:` y serait une faille XSS stockée.
 */
function safeRedirectUrl(candidate: unknown): string | null {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;

  try {
    const url = new URL(candidate.trim(), window.location.origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}
