import Link from 'next/link';
import { ArrowRight, Download } from 'lucide-react';

import { getBackgroundStyle } from '@/lib/theme';
import {
  attributedFormPath,
  landingCta,
  landingHeading,
  landingPartnerLabel
} from '@/lib/partners';
import { pickText } from '@/lib/email/tokens';
import type { PublicPartnerLink } from '@/types';

/**
 * La page d'accueil d'un lien partenaire — /a/<code>.
 *
 * Elle a un seul travail : faire cliquer sur « S'inscrire ». Tout ce qui est
 * ici sert cet objectif, et rien d'autre n'y figure — ni menu, ni pied de page,
 * ni lien vers Papyrus. Un visiteur arrive par le lien d'un partenaire qu'il
 * connaît ; l'outil qui sert la page ne le regarde pas.
 *
 * Le partenaire est nommé en haut et non en bas : c'est sa recommandation qui
 * amène le visiteur, et la reléguer sous le pli reviendrait à la retirer.
 */
export function PartnerLanding({ link }: { link: PublicPartnerLink }) {
  const config = link.partner_config;
  const language = link.default_language || 'fr';
  const accent = link.project_theme?.accent || '#052139';

  const heading = landingHeading(config, link.project_name, language);
  const message = pickText(config.message, language);
  const pdfLabel = pickText(config.pdf_label, language);

  const href = link.form_slug ? attributedFormPath(link.form_slug, link.code) : null;

  return (
    <div
      className="min-h-screen"
      style={{ background: 'var(--papyrus-bg)', ...getBackgroundStyle(link.project_theme) }}
    >
      <div className="mx-auto max-w-2xl px-6 py-14 sm:py-20">
        <header className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-tertiary">
            {landingPartnerLabel(config, language)}
          </p>

          {link.partner_logo_url ? (
            <PartnerMark link={link} />
          ) : (
            <p className="mt-3 font-display text-xl font-bold text-text-primary">
              {link.partner_name}
            </p>
          )}
        </header>

        <div className="mt-10 overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-sm">
          {config.image_url && (
            // Balise `img` et non `next/image` : le média est servi par R2,
            // dont le domaine n'est pas déclaré à l'optimiseur — qui refuserait
            // alors l'image, et la page s'afficherait sans visuel.
            <img
              src={config.image_url}
              alt=""
              className="aspect-[16/9] w-full object-cover"
            />
          )}

          <div className="p-8 sm:p-10">
            <h1 className="font-display text-3xl font-bold leading-tight text-text-primary sm:text-4xl">
              {heading}
            </h1>

            {message && (
              <div className="mt-5 whitespace-pre-line text-base leading-relaxed text-text-secondary">
                {message}
              </div>
            )}

            {config.pdf_url && (
              <a
                href={config.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:border-border-strong"
              >
                <Download className="h-4 w-4 shrink-0" aria-hidden />
                {pdfLabel || config.pdf_name || 'Télécharger le programme'}
              </a>
            )}

            <div className="mt-9">
              {href ? (
                <Link
                  href={href}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-6 py-4 font-display text-base font-bold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:w-auto"
                  style={{ backgroundColor: accent, outlineColor: accent }}
                >
                  {landingCta(config, language)}
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                </Link>
              ) : (
                /* Le projet n'a aucun formulaire publié. Dire « inscriptions pas
                   encore ouvertes » plutôt que d'afficher un bouton mort : le
                   visiteur repart en sachant qu'il doit revenir. */
                <p className="rounded-xl border border-dashed border-border-strong px-5 py-4 text-sm text-text-secondary">
                  Les inscriptions ne sont pas encore ouvertes. Revenez bientôt.
                </p>
              )}
            </div>
          </div>
        </div>

        {link.partner_website && (
          <p className="mt-8 text-center text-sm text-text-tertiary">
            <a
              href={link.partner_website}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline-offset-4 transition-colors hover:text-text-secondary hover:underline"
            >
              {displayHost(link.partner_website)}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

function PartnerMark({ link }: { link: PublicPartnerLink }) {
  return (
    <div className="mt-4 flex justify-center">
      {/* Balise `img` : média R2, cf. plus haut. */}
      <img
        src={link.partner_logo_url}
        alt={link.partner_name}
        className="h-14 w-auto max-w-[220px] object-contain"
      />
    </div>
  );
}

/** « https://acme.mu/partenaires » se lit « acme.mu ». */
function displayHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
