'use client';

/**
 * Partenaires, participations et contacts — côté navigateur.
 *
 * Tout passe par la RLS : ces trois tables ont quatre policies chacune, et
 * l'appartenance à l'espace de travail y est vérifiée par la base. Il n'y a donc
 * aucune raison de faire transiter ces écritures par une route serveur — une
 * route en `service_role` devrait revérifier à la main ce que la policy fait
 * déjà, et c'est exactement là que naissent les trous.
 *
 * Les trois seules opérations qui ont besoin du serveur sont ailleurs : émettre
 * un lien d'invitation (API d'administration Supabase), le portail partenaire
 * (le partenaire n'a aucune policy) et l'export XLSX.
 */

import { createClient } from '@/lib/supabase/client';
import { generatePartnerCode } from '@/lib/partners';
import { extractContact } from '@/lib/contacts';
import type {
  CommissionConfirmedBy,
  Contact,
  Form,
  Partner,
  PartnerStatus,
  Project,
  ProjectPartner
} from '@/types';

// ============================================================================
// Annuaire
// ============================================================================

export async function listPartners(teamId: string): Promise<Partner[]> {
  const { data, error } = await createClient()
    .from('partners')
    .select('*, project_partners(id)')
    .eq('team_id', teamId)
    .order('name', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const { project_partners: links, ...partner } = row as Partner & {
      project_partners?: { id: string }[];
    };
    return { ...partner, project_count: (links ?? []).length } as Partner;
  });
}

export interface CreatePartnerInput {
  teamId: string;
  name: string;
  email?: string;
  phone?: string;
  website?: string;
  logoUrl?: string;
  notes?: string;
}

export async function createPartner(input: CreatePartnerInput): Promise<Partner> {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('partners')
    .insert({
      team_id: input.teamId,
      name: input.name.trim(),
      // Toujours en minuscules : l'unicité en base porte sur `lower(email)`, et
      // deux saisies qui ne diffèrent que par une majuscule doivent se heurter
      // ici plutôt que produire deux fiches et deux portails.
      email: (input.email ?? '').trim().toLowerCase(),
      phone: (input.phone ?? '').trim(),
      website: (input.website ?? '').trim(),
      logo_url: (input.logoUrl ?? '').trim(),
      notes: (input.notes ?? '').trim(),
      created_by: user?.id ?? null
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as Partner;
}

export async function updatePartner(
  id: string,
  patch: Partial<Pick<Partner, 'name' | 'email' | 'phone' | 'website' | 'logo_url' | 'notes' | 'status'>>
): Promise<Partner | null> {
  const row = { ...patch };
  if (row.email !== undefined) row.email = row.email.trim().toLowerCase();

  const { data, error } = await createClient()
    .from('partners')
    .update(row)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return (data as Partner) ?? null;
}

/**
 * Supprime un partenaire, ses participations et ses statistiques de visite.
 *
 * Les réponses qu'il a amenées, elles, restent : `submissions.project_partner_id`
 * passe à NULL par contrainte. Une inscription payée ne disparaît pas parce
 * qu'on a fait le ménage dans l'annuaire.
 */
export async function deletePartner(id: string): Promise<void> {
  const { error } = await createClient().from('partners').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================================
// Participations
// ============================================================================

export async function listProjectPartners(projectId: string): Promise<ProjectPartner[]> {
  const { data, error } = await createClient()
    .from('project_partners')
    .select('*, partners(id, name, email, logo_url, status, portal_token)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const { partners: partner, ...link } = row as ProjectPartner & {
      partners?: ProjectPartner['partner'];
    };
    return { ...link, partner } as ProjectPartner;
  });
}

/** Code Postgres d'une violation d'unicité. */
const UNIQUE_VIOLATION = '23505';

/**
 * Rattache un partenaire à un projet et lui fabrique son lien.
 *
 * La boucle retente sur collision de code — et uniquement sur celle-là. Un
 * partenaire déjà rattaché viole aussi une contrainte d'unicité, mais retenter
 * ne changerait rien : le message doit dire lequel des deux cas s'est produit,
 * sans quoi l'écran affiche « réessayez » pour une situation qui ne se résoudra
 * jamais toute seule.
 */
export async function attachPartner(
  projectId: string,
  partner: Pick<Partner, 'id' | 'name'>
): Promise<ProjectPartner> {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  let lastError: { code?: string; message?: string } | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase
      .from('project_partners')
      .insert({
        project_id: projectId,
        partner_id: partner.id,
        code: generatePartnerCode(partner.name),
        created_by: user?.id ?? null
      })
      .select('*, partners(id, name, email, logo_url, status, portal_token)')
      .single();

    if (!error) {
      const { partners: joined, ...link } = data as ProjectPartner & {
        partners?: ProjectPartner['partner'];
      };
      return { ...link, partner: joined } as ProjectPartner;
    }

    lastError = error;

    if (error.code !== UNIQUE_VIOLATION) break;
    if (!/code/.test(error.message ?? '')) {
      throw new Error('Ce partenaire participe déjà à ce projet.');
    }
  }

  throw new Error(lastError?.message ?? "Le lien de partage n'a pas pu être créé.");
}

export async function updateProjectPartner(
  id: string,
  patch: { status?: PartnerStatus; code?: string }
): Promise<ProjectPartner | null> {
  const { data, error } = await createClient()
    .from('project_partners')
    .update(patch)
    .eq('id', id)
    .select('*, partners(id, name, email, logo_url, status, portal_token)')
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { partners: joined, ...link } = data as ProjectPartner & {
    partners?: ProjectPartner['partner'];
  };
  return { ...link, partner: joined } as ProjectPartner;
}

export async function detachPartner(id: string): Promise<void> {
  const { error } = await createClient().from('project_partners').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================================
// Commissions — côté équipe
// ============================================================================

/**
 * Marque un lot de commissions versées, ou rouvre celles qui l'étaient.
 *
 * Écrit sur `submissions` sous RLS, donc uniquement sur les réponses des
 * formulaires de l'espace de travail. Le contrôle « le client a-t-il payé ? »
 * est fait par l'appelant, qui seul connaît les lignes affichées ; la même
 * vérification est refaite côté portail, où c'est le partenaire qui déclenche.
 */
export async function setCommissionPaid(
  submissionIds: string[],
  paid: boolean,
  by: CommissionConfirmedBy = 'staff'
): Promise<void> {
  if (submissionIds.length === 0) return;

  const { error } = await createClient()
    .from('submissions')
    .update(
      paid
        ? { commission_paid_at: new Date().toISOString(), commission_paid_by: by }
        : { commission_paid_at: null, commission_paid_by: '' }
    )
    .in('id', submissionIds);

  if (error) throw error;
}

// ============================================================================
// Contacts
// ============================================================================

export async function listContacts(teamId: string): Promise<Contact[]> {
  const { data, error } = await createClient()
    .from('contacts')
    .select('*')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Contact[];
}

export async function updateContact(
  id: string,
  patch: Partial<Pick<Contact, 'name' | 'email' | 'phone' | 'company' | 'notes'>>
): Promise<Contact | null> {
  const { data, error } = await createClient()
    .from('contacts')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return (data as Contact) ?? null;
}

export async function deleteContact(id: string): Promise<void> {
  const { error } = await createClient().from('contacts').delete().eq('id', id);
  if (error) throw error;
}

export interface GatherResult {
  /** Contacts créés. */
  added: number;
  /** Déjà présents — le geste est donc rejouable sans rien dupliquer. */
  existing: number;
  /** Réponses sans adresse e-mail : rien à quoi écrire, donc rien à garder. */
  skipped: number;
}

/**
 * Constitue le carnet d'adresses d'un projet à partir de ses réponses.
 *
 * mooove-invoice ne le fait qu'à l'archivage d'un projet. C'est trop tard : on
 * veut écrire aux inscrits pendant l'événement, pas seulement après. Le geste
 * est donc explicite et rejouable — chaque nouvelle inscription s'ajoute au
 * passage suivant, et aucune n'est dupliquée.
 *
 * Les réponses annulées sont exclues, comme partout ailleurs depuis la phase 5 :
 * une inscription annulée ne laisse pas un contact derrière elle.
 */
export async function gatherProjectContacts(
  project: Pick<Project, 'id' | 'team_id' | 'name'>,
  forms: Form[]
): Promise<GatherResult> {
  const supabase = createClient();
  const formIds = forms.map((form) => form.id);

  if (formIds.length === 0) return { added: 0, existing: 0, skipped: 0 };

  const [{ data: rows, error }, { data: known }] = await Promise.all([
    supabase
      .from('submissions')
      .select('id, form_id, responses, respondent_email, respondent_language, completed_at')
      .in('form_id', formIds)
      .eq('is_partial', false)
      .neq('status', 'void')
      .order('completed_at', { ascending: true }),
    supabase.from('contacts').select('email').eq('project_id', project.id)
  ]);

  if (error) throw error;

  const byId = new Map(forms.map((form) => [form.id, form] as const));
  const seen = new Set(
    ((known ?? []) as { email: string }[]).map((row) => row.email.trim().toLowerCase())
  );

  const result: GatherResult = { added: 0, existing: 0, skipped: 0 };
  const inserts: Record<string, unknown>[] = [];

  for (const row of (rows ?? []) as {
    id: string;
    form_id: string;
    responses: Record<string, unknown> | null;
    respondent_email: string | null;
    respondent_language: string | null;
  }[]) {
    const extracted = extractContact(byId.get(row.form_id), row.responses, row.respondent_email);
    const key = extracted.email.trim().toLowerCase();

    if (!key) {
      result.skipped += 1;
      continue;
    }
    if (seen.has(key)) {
      result.existing += 1;
      continue;
    }

    seen.add(key);
    inserts.push({
      team_id: project.team_id,
      project_id: project.id,
      project_name: project.name,
      submission_id: row.id,
      name: extracted.name,
      email: key,
      phone: extracted.phone,
      company: extracted.company,
      language: row.respondent_language ?? ''
    });
  }

  if (inserts.length > 0) {
    const { error: insertError } = await supabase.from('contacts').insert(inserts);
    if (insertError) throw insertError;
    result.added = inserts.length;
  }

  return result;
}
