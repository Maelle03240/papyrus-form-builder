import 'server-only';

import { NextResponse } from 'next/server';

import { createAdminClient, createClient } from '@/lib/supabase/server';
import { generatePartnerCode } from '@/lib/partners';
import type { Partner } from '@/types';

/**
 * Le côté serveur du programme partenaire : identité, invitation, attribution.
 *
 * Rappel de l'invariant du produit : toute fonction d'ici qui emploie
 * `createAdminClient()` contourne la RLS et doit donc vérifier elle-même les
 * droits de l'appelant. Les trois gardes ci-dessous existent pour qu'aucune
 * route n'ait à réinventer cette vérification — c'est en la réécrivant à chaque
 * fois qu'on finit par en oublier une.
 */

// ============================================================================
// Gardes
// ============================================================================

export interface PartnerIdentity {
  userId: string;
  partner: Partner;
}

/**
 * L'appelant est-il bien LE partenaire désigné par ce jeton de portail ?
 *
 * Le jeton dit de qui est le portail ; la session dit qui frappe à la porte.
 * Les deux sont nécessaires : sans le jeton, un partenaire ne saurait pas quelle
 * fiche ouvrir quand il en a plusieurs ; sans la session, le lien seul suffirait
 * à lire les chiffres de quelqu'un d'autre — et un lien se transfère.
 */
export async function requirePartnerByToken(
  token: string
): Promise<{ error: NextResponse } | PartnerIdentity> {
  const {
    data: { user }
  } = await createClient().auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) };
  }

  const { data: partner } = await createAdminClient()
    .from('partners')
    .select('*')
    .eq('portal_token', token)
    .maybeSingle();

  // Même réponse pour « ce portail n'existe pas » et « ce portail n'est pas le
  // vôtre » : distinguer les deux permettrait de deviner quels jetons existent.
  if (!partner || partner.user_id !== user.id || partner.status !== 'active') {
    return { error: NextResponse.json({ error: 'Portail introuvable' }, { status: 404 }) };
  }

  return { userId: user.id, partner: partner as Partner };
}

/** Le partenaire connecté, quelle que soit sa fiche — pour les routes du portail. */
export async function requireAnyPartner(): Promise<
  { error: NextResponse } | { userId: string; partnerIds: string[] }
> {
  const {
    data: { user }
  } = await createClient().auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) };
  }

  const { data } = await createAdminClient()
    .from('partners')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'active');

  const partnerIds = (data ?? []).map((row: { id: string }) => row.id);
  if (partnerIds.length === 0) {
    return { error: NextResponse.json({ error: 'Portail introuvable' }, { status: 404 }) };
  }

  return { userId: user.id, partnerIds };
}

/** L'appelant est-il membre de l'espace de travail d'un partenaire donné ? */
export async function requirePartnerAccess(
  partnerId: string
): Promise<{ error: NextResponse } | { userId: string; partner: Partner }> {
  const {
    data: { user }
  } = await createClient().auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) };
  }

  const admin = createAdminClient();

  const { data: partner } = await admin
    .from('partners')
    .select('*')
    .eq('id', partnerId)
    .maybeSingle();

  if (!partner) {
    return { error: NextResponse.json({ error: 'Partenaire introuvable' }, { status: 404 }) };
  }

  const { data: membership } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', partner.team_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) {
    return { error: NextResponse.json({ error: 'Partenaire introuvable' }, { status: 404 }) };
  }

  return { userId: user.id, partner: partner as Partner };
}

// ============================================================================
// Invitation
// ============================================================================

export interface PartnerInvite {
  /** Lien à transmettre au partenaire. Nul si Supabase n'a pas pu en émettre un. */
  link: string | null;
  userId: string | null;
  /** Ce qui a empêché l'émission, à afficher au personnel sans le maquiller. */
  error?: string;
}

/**
 * Ouvre — ou rouvre — l'accès au portail d'un partenaire.
 *
 * Le lien est RENDU au personnel, pas seulement envoyé. Aucun serveur SMTP n'est
 * configuré sur cette instance : compter sur l'e-mail de Supabase donnerait une
 * invitation qui n'arrive jamais, sans le moindre message d'erreur. Le personnel
 * copie donc le lien et le transmet comme il veut ; si l'envoi automatique est
 * un jour branché, il s'ajoutera sans rien changer ici.
 */
export async function issuePartnerInvite(
  email: string,
  redirectTo: string
): Promise<PartnerInvite> {
  const admin = createAdminClient();
  const address = email.trim().toLowerCase();

  if (!address) {
    return { link: null, userId: null, error: 'Ce partenaire n’a pas d’adresse e-mail.' };
  }

  // `invite` crée le compte ; il échoue si l'adresse en a déjà un — ce qui est
  // le cas dès la deuxième équipe qui travaille avec le même partenaire, et dès
  // le second envoi du lien. On bascule alors sur un lien de connexion.
  const invited = await admin.auth.admin.generateLink({
    type: 'invite',
    email: address,
    options: { redirectTo }
  });

  if (!invited.error && invited.data?.properties?.action_link) {
    const userId = invited.data.user?.id ?? null;

    if (userId) {
      // Le rôle vit dans `app_metadata` et non dans `user_metadata` : le second
      // est modifiable par son propre titulaire, et un partenaire pourrait donc
      // se déclarer membre de l'équipe.
      await admin.auth.admin.updateUserById(userId, {
        app_metadata: { papyrus_role: 'partner' }
      });
    }

    return { link: invited.data.properties.action_link, userId };
  }

  const magic = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: address,
    options: { redirectTo }
  });

  if (magic.error || !magic.data?.properties?.action_link) {
    return {
      link: null,
      userId: null,
      error: magic.error?.message ?? 'Le lien d’accès n’a pas pu être créé.'
    };
  }

  return { link: magic.data.properties.action_link, userId: magic.data.user?.id ?? null };
}

// ============================================================================
// Codes de partage
// ============================================================================

/**
 * Un code libre pour ce partenaire.
 *
 * La contrainte d'unicité en base reste l'autorité : cette boucle réduit la
 * probabilité de collision, elle ne la supprime pas, et l'appelant doit encore
 * traiter l'erreur d'insertion. Croire l'inverse, c'est écrire un test qui passe
 * et une création qui échoue une fois sur mille en production.
 */
export async function allocatePartnerCode(name: string): Promise<string> {
  const admin = createAdminClient();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generatePartnerCode(name);
    const { data } = await admin
      .from('project_partners')
      .select('id')
      .eq('code', code)
      .maybeSingle();

    if (!data) return code;
  }

  // Cinq collisions d'affilée sur un espace de 923 521 suffixes signalent autre
  // chose qu'un hasard malheureux : on rallonge plutôt que de boucler sans fin.
  return `${generatePartnerCode(name)}-${Date.now().toString(36).slice(-4)}`;
}

// ============================================================================
// Attribution et visites
// ============================================================================

/**
 * Le lien partenaire désigné par un code, s'il porte bien sur ce formulaire.
 *
 * La vérification du projet n'est pas une formalité : sans elle, coller le code
 * d'un partenaire d'un autre projet sur l'URL d'un formulaire lui attribuerait
 * des commissions qu'il n'a pas apportées.
 */
export async function resolveAttribution(
  code: string | null | undefined,
  projectId: string | null | undefined
): Promise<string | null> {
  if (!code || !projectId) return null;

  const { data } = await createAdminClient()
    .from('project_partners')
    .select('id, project_id, status')
    .eq('code', code)
    .maybeSingle();

  if (!data || data.project_id !== projectId || data.status !== 'active') return null;
  return data.id as string;
}

/** Fenêtre de dédoublonnage des visites — trente minutes, comme mooove-invoice. */
const CLICK_WINDOW_MS = 30 * 60 * 1000;

/**
 * Enregistre une visite de page d'accueil partenaire.
 *
 * Le visiteur est identifié par un cookie tiré au sort, pas par son adresse IP.
 * mooove-invoice stocke l'IP en clair ; Papyrus a déjà tranché l'inverse pour
 * les réponses (« sans sel configuré, on préfère ne rien stocker qu'un hachage
 * faible »), et une IP hachée avec un sel connu se retrouve de toute façon par
 * force brute — l'espace des adresses est minuscule. Le cookie n'est pas un
 * pis-aller : derrière un partage de connexion, une IP confond dix visiteurs en
 * un seul, là où un cookie les distingue.
 *
 * L'unicité (lien, visiteur, fenêtre) rend le dédoublonnage atomique : deux
 * onglets ouverts en même temps se heurtent au conflit plutôt que de compter
 * deux fois, et le compteur n'est incrémenté que si la ligne est bien née.
 */
export async function recordPartnerClick(
  projectPartnerId: string,
  visitorId: string,
  userAgent: string
): Promise<void> {
  // Sans cookie — visiteur qui les refuse, sonde automatique — on ne compte
  // rien plutôt que de tout attribuer à un même visiteur vide, ce qui ferait
  // une visite par demi-heure quel que soit le trafic réel.
  if (!visitorId) return;

  const admin = createAdminClient();

  const windowStart = new Date(
    Math.floor(Date.now() / CLICK_WINDOW_MS) * CLICK_WINDOW_MS
  ).toISOString();

  const { data, error } = await admin
    .from('partner_clicks')
    .insert({
      project_partner_id: projectPartnerId,
      visitor_hash: visitorId.slice(0, 64),
      window_start: windowStart,
      user_agent: userAgent.slice(0, 500)
    })
    .select('id')
    .maybeSingle();

  // Conflit d'unicité = même visiteur dans la même demi-heure. Ce n'est pas une
  // panne : on ne compte simplement pas deux fois.
  if (error || !data) return;

  await admin.rpc('increment_partner_clicks', { p_link: projectPartnerId });
}
