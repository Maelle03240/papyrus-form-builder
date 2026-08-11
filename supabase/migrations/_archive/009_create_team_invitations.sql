-- ============================================================================
-- Papyrus — Migration 009 : Système d'invitations team
-- Ajoute table pour gérer invitations par email et par lien
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table des invitations team
-- ----------------------------------------------------------------------------
create table if not exists team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade not null,
  invited_by uuid references auth.users(id) on delete set null,

  -- Type d'invitation
  invitation_type text check (invitation_type in ('email', 'link')) not null,

  -- Pour invitations par email
  email text, -- email du destinataire (null pour invitations par lien)

  -- Pour invitations par lien
  invite_token text unique, -- token unique pour le lien (null pour invitations par email)

  -- Métadonnées
  role text check (role in ('admin', 'member')) default 'member',
  status text check (status in ('pending', 'accepted', 'expired')) default 'pending',
  expires_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),

  -- Contraintes : une invitation par email OU un token unique
  constraint valid_invitation_data check (
    (invitation_type = 'email' and email is not null and invite_token is null) or
    (invitation_type = 'link' and email is null and invite_token is not null)
  )
);

-- Index pour performance
create index if not exists idx_team_invitations_team_id on team_invitations(team_id);
create index if not exists idx_team_invitations_email on team_invitations(email);
create index if not exists idx_team_invitations_token on team_invitations(invite_token);
create index if not exists idx_team_invitations_status on team_invitations(status);

-- ----------------------------------------------------------------------------
-- Policies RLS pour team_invitations
-- ----------------------------------------------------------------------------
alter table team_invitations enable row level security;

-- Les admins peuvent voir/gérer toutes les invitations de leurs teams
create policy "Team admins can manage team invitations" on team_invitations
  for all using (
    exists (
      select 1 from team_members tm
      where tm.team_id = team_invitations.team_id
      and tm.user_id = auth.uid()
      and tm.role = 'admin'
    )
  );

-- Tout utilisateur authentifié peut voir les invitations qui lui sont destinées (par email)
create policy "Users can view their email invitations" on team_invitations
  for select using (
    auth.uid() is not null and
    invitation_type = 'email' and
    email = (
      select email from auth.users where id = auth.uid()
    )
  );

-- Tout utilisateur authentifié peut accepter une invitation avec un token valide
create policy "Users can view valid link invitations" on team_invitations
  for select using (
    auth.uid() is not null and
    invitation_type = 'link' and
    status = 'pending' and
    expires_at > now()
  );

-- ----------------------------------------------------------------------------
-- Fonction pour nettoyer les invitations expirées
-- ----------------------------------------------------------------------------
create or replace function cleanup_expired_invitations()
returns void
language plpgsql
security definer
as $$
begin
  update team_invitations
  set status = 'expired'
  where status = 'pending'
  and expires_at < now();
end;
$$;

-- ----------------------------------------------------------------------------
-- Fonction pour accepter une invitation
-- ----------------------------------------------------------------------------
create or replace function accept_team_invitation(invitation_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  invitation_record record;
  user_email text;
  result jsonb;
begin
  -- Récupérer l'email de l'utilisateur connecté
  select email into user_email
  from auth.users
  where id = auth.uid();

  if user_email is null then
    return jsonb_build_object('success', false, 'error', 'User not authenticated');
  end if;

  -- Récupérer l'invitation
  select * into invitation_record
  from team_invitations
  where id = invitation_id
  and status = 'pending'
  and expires_at > now();

  if not found then
    return jsonb_build_object('success', false, 'error', 'Invalid or expired invitation');
  end if;

  -- Vérifier si l'utilisateur peut accepter cette invitation
  if invitation_record.invitation_type = 'email' and invitation_record.email != user_email then
    return jsonb_build_object('success', false, 'error', 'This invitation is not for your email address');
  end if;

  -- Vérifier si l'utilisateur n'est pas déjà membre de la team
  if exists (
    select 1 from team_members
    where team_id = invitation_record.team_id
    and user_id = auth.uid()
  ) then
    return jsonb_build_object('success', false, 'error', 'You are already a member of this team');
  end if;

  -- Ajouter l'utilisateur à la team
  insert into team_members (user_id, team_id, role)
  values (auth.uid(), invitation_record.team_id, invitation_record.role);

  -- Marquer l'invitation comme acceptée
  update team_invitations
  set status = 'accepted',
      accepted_at = now(),
      accepted_by = auth.uid()
  where id = invitation_id;

  return jsonb_build_object('success', true, 'team_id', invitation_record.team_id);
exception
  when others then
    return jsonb_build_object('success', false, 'error', SQLERRM);
end;
$$;