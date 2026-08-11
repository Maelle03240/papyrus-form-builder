import 'server-only';

import { createAdminClient } from '@/lib/supabase/server';

/**
 * Contrôle d'accès à l'inscription — « qui a le droit d'entrer ».
 *
 * Google accepte de connecter n'importe quel compte Google du monde entier.
 * Sans filtre, activer « Se connecter avec Google » ouvrirait Papyrus à tout
 * internaute. La liste de domaines autorisés, réglable dans l'écran
 * Administration, est donc la barrière qui rend ce bouton utilisable.
 *
 * Elle est appliquée côté serveur, au retour du callback OAuth : une
 * vérification côté client serait triviale à contourner.
 */

export interface AccessSettings {
  allowedEmailDomains: string[];
  allowPublicSignup: boolean;
}

/** Réglages d'instance. En cas d'erreur, on renvoie la configuration la plus permissive connue. */
export async function getAccessSettings(): Promise<AccessSettings> {
  const { data, error } = await createAdminClient()
    .from('app_settings')
    .select('allowed_email_domains, allow_public_signup')
    .eq('id', true)
    .maybeSingle();

  if (error || !data) {
    return { allowedEmailDomains: [], allowPublicSignup: true };
  }

  return {
    allowedEmailDomains: (data.allowed_email_domains ?? []).map((d: string) => d.toLowerCase()),
    allowPublicSignup: data.allow_public_signup ?? true
  };
}

/** Normalise une saisie de domaine : « @Mooove.LIVE », « https://mooove.live/ » → « mooove.live ». */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '')
    .replace(/\s/g, '');
}

/** Vérifie qu'une chaîne ressemble à un nom de domaine. */
export function isValidDomain(domain: string): boolean {
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain);
}

/** Partie domaine d'une adresse email. */
export function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; reason: 'domain_not_allowed' | 'signup_closed' | 'invalid_email' };

/**
 * Un compte peut-il accéder à Papyrus ?
 *
 * Un utilisateur déjà membre d'un espace garde son accès même si les règles
 * changent ensuite — retirer un domaine de la liste ne doit pas éjecter une
 * équipe entière du jour au lendemain. Les règles ne filtrent que les entrants.
 */
export async function evaluateAccess(email: string | undefined, userId: string): Promise<AccessDecision> {
  if (!email) return { allowed: false, reason: 'invalid_email' };

  const domain = domainOf(email);
  if (!domain) return { allowed: false, reason: 'invalid_email' };

  const admin = createAdminClient();

  // Membre existant : accès conservé.
  const { data: membership } = await admin
    .from('team_members')
    .select('user_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (membership) return { allowed: true };

  // Invitation nominative en attente : accès accordé quel que soit le domaine.
  const { data: invitation } = await admin
    .from('team_invitations')
    .select('id')
    .eq('email', email.toLowerCase())
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();

  if (invitation) return { allowed: true };

  const settings = await getAccessSettings();

  if (!settings.allowPublicSignup) {
    return { allowed: false, reason: 'signup_closed' };
  }

  // Liste vide = aucune restriction de domaine.
  if (settings.allowedEmailDomains.length === 0) return { allowed: true };

  const allowed = settings.allowedEmailDomains.some(
    (candidate) => domain === candidate || domain.endsWith(`.${candidate}`)
  );

  return allowed ? { allowed: true } : { allowed: false, reason: 'domain_not_allowed' };
}

/** Message affiché à l'utilisateur refusé, sans révéler la configuration exacte. */
export function accessDeniedMessage(reason: AccessDecision extends { allowed: false } ? never : string): string {
  switch (reason) {
    case 'signup_closed':
      return "Les inscriptions sont fermées. Demandez une invitation à un administrateur.";
    case 'domain_not_allowed':
      return "Votre adresse email n'appartient pas à un domaine autorisé sur cet espace Papyrus.";
    default:
      return 'Adresse email invalide.';
  }
}

/** L'utilisateur est-il super-administrateur de l'instance ? */
export async function isAppAdmin(userId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from('app_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  return Boolean(data);
}
