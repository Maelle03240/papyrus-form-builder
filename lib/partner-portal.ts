import 'server-only';

import { createAdminClient, createClient } from '@/lib/supabase/server';
import { partnerConfigOf } from '@/lib/partners';
import type {
  Partner,
  PartnerOpenProject,
  PartnerPortalLink,
  PartnerRegistration
} from '@/types';

/**
 * Ce que le portail d'un partenaire affiche.
 *
 * Les trois lectures passent par le client de SESSION, pas par `service_role` :
 * les vues `partner_*` se filtrent elles-mêmes sur `current_partner_ids()`, donc
 * c'est la base qui décide de ce que ce partenaire voit. Employer la clé
 * d'administration ici reviendrait à réécrire ce filtre à la main dans chaque
 * requête — et à en oublier un le jour où l'on en ajoutera une quatrième.
 *
 * Seule la fiche partenaire est lue en `service_role`, parce qu'elle sert
 * justement à décider si le portail s'ouvre.
 */

export type PortalState =
  /** Personne n'est connecté : le portail affiche son écran d'entrée. */
  | { state: 'anonymous' }
  /** Connecté, mais ce portail n'est pas le sien — ou n'existe pas. */
  | { state: 'forbidden' }
  | {
      state: 'ok';
      partner: Partner;
      links: PartnerPortalLink[];
      registrations: PartnerRegistration[];
      openProjects: PartnerOpenProject[];
    };

export async function loadPortal(token: string): Promise<PortalState> {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return { state: 'anonymous' };

  const { data: partner } = await createAdminClient()
    .from('partners')
    .select('*')
    .eq('portal_token', token)
    .maybeSingle();

  // Un jeton inconnu et un jeton qui appartient à quelqu'un d'autre donnent le
  // même écran : les distinguer permettrait de deviner quels portails existent.
  if (!partner || partner.user_id !== user.id || partner.status !== 'active') {
    return { state: 'forbidden' };
  }

  const [links, registrations, open] = await Promise.all([
    supabase
      .from('partner_portal_links')
      .select('*')
      .eq('partner_id', partner.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('partner_registrations')
      .select('*')
      .eq('partner_id', partner.id)
      .order('completed_at', { ascending: false }),
    supabase.from('partner_open_projects').select('*').eq('partner_id', partner.id)
  ]);

  // Trace de passage, pour que l'équipe sache si un partenaire a ouvert son
  // portail. Elle n'a pas le droit de faire échouer l'affichage : un partenaire
  // qui vient voir ses commissions n'a pas à tomber sur une erreur parce qu'une
  // colonne d'horodatage n'a pas pu être écrite.
  void createAdminClient()
    .from('partners')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', partner.id)
    .then(
      () => undefined,
      (error: unknown) => console.error('Horodatage de visite partenaire échoué:', error)
    );

  return {
    state: 'ok',
    partner: partner as Partner,
    links: ((links.data ?? []) as PartnerPortalLink[]).map((link) => ({
      ...link,
      partner_config: partnerConfigOf(link.partner_config)
    })),
    registrations: (registrations.data ?? []) as PartnerRegistration[],
    openProjects: ((open.data ?? []) as PartnerOpenProject[]).map((project) => ({
      ...project,
      partner_config: partnerConfigOf(project.partner_config)
    }))
  };
}

/**
 * Les portails du partenaire connecté — pour `/p`, qui ne porte aucun jeton.
 *
 * Il existe parce qu'un lien de portail se perd : le partenaire tape l'adresse
 * du produit, se connecte, et doit arriver quelque part plutôt que sur une page
 * qui lui demande un jeton qu'il n'a plus.
 */
export async function listOwnPortals(): Promise<Partner[]> {
  const {
    data: { user }
  } = await createClient().auth.getUser();

  if (!user) return [];

  const { data } = await createAdminClient()
    .from('partners')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('name', { ascending: true });

  return (data ?? []) as Partner[];
}
