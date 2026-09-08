-- Les invitations d'équipe, qui n'ont jamais fonctionné.
--
-- Trouvé en traversant l'application écran par écran. Le parcours complet —
-- inviter un collègue, lui envoyer le lien, le voir rejoindre — cassait à
-- **quatre** endroits, chacun invisible depuis les autres :
--
-- 1. Créer l'invitation était refusé par la RLS : `team_invitations` n'avait
--    que des policies de LECTURE. Corrigé par la migration 011.
--
-- 2. Lister les membres échouait sur `PGRST200` : le code demandait à PostgREST
--    de suivre un lien entre `team_members` et `profiles` qui n'existe pas —
--    les deux pointent vers `auth.users`, jamais l'un vers l'autre. Corrigé
--    côté application, par deux requêtes au lieu d'une jointure devinée.
--
-- 3. **Ouvrir un lien d'invitation ne montrait rien.** L'invité n'est ni membre
--    ni administrateur de l'équipe : aucune policy de lecture ne le concerne,
--    et la page affichait « cette invitation n'existe pas ou a expiré » à
--    quelqu'un qui tenait un lien parfaitement valide. C'est ce que corrige
--    `invitation_by_token` ci-dessous.
--
-- 4. **Accepter appelait une fonction qui n'existe pas.** Le code appelle
--    `accept_team_invitation` depuis toujours ; elle n'a jamais été créée dans
--    aucune migration. La voici.
--
-- Pourquoi des fonctions `security definer` et non des policies : l'invité n'a
-- par définition aucun droit sur l'équipe qu'il rejoint. Lui ouvrir
-- `team_invitations` en lecture reviendrait à laisser n'importe qui énumérer
-- toutes les invitations en attente — donc tous les jetons, donc rejoindre
-- n'importe quelle équipe. Une fonction qui exige le jeton exact ne se
-- parcourt pas.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Lire une invitation à partir de son jeton
-- ════════════════════════════════════════════════════════════════════════════

create or replace function papyrus.invitation_by_token(p_token text)
returns table (
  id uuid,
  team_id uuid,
  team_name text,
  role text,
  invitation_type text,
  email text,
  expires_at timestamptz
)
language sql
security definer
stable
set search_path = papyrus, public
as $$
  select i.id, i.team_id, t.name, i.role, i.invitation_type,
         -- L'adresse invitée n'est renvoyée que pour une invitation nominative,
         -- où celui qui tient le lien la connaît déjà : c'est la sienne.
         case when i.invitation_type = 'email' then i.email else null end,
         i.expires_at
  from papyrus.team_invitations i
  join papyrus.teams t on t.id = i.team_id
  where i.invite_token = p_token
    and i.status = 'pending'
    and i.expires_at > now()
  limit 1;
$$;

-- Un jeton vide ou faux ne renvoie rien : la fonction est sans danger pour un
-- visiteur non connecté, qui doit pouvoir lire l'invitation avant de créer son
-- compte.
revoke all on function papyrus.invitation_by_token(text) from public;
grant execute on function papyrus.invitation_by_token(text) to anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Accepter une invitation
-- ════════════════════════════════════════════════════════════════════════════

create or replace function papyrus.accept_team_invitation(invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = papyrus, public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_invitation papyrus.team_invitations;
begin
  if v_user is null then
    return jsonb_build_object('success', false, 'error', 'Connectez-vous pour rejoindre cette équipe.');
  end if;

  select * into v_invitation
  from papyrus.team_invitations
  where id = invitation_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Cette invitation n’existe plus.');
  end if;

  if v_invitation.status <> 'pending' then
    -- Déjà acceptée par la même personne : ce n'est pas une erreur, c'est un
    -- double clic ou un lien rouvert. On renvoie l'équipe.
    if v_invitation.status = 'accepted' and v_invitation.accepted_by = v_user then
      return jsonb_build_object('success', true, 'team_id', v_invitation.team_id);
    end if;
    return jsonb_build_object('success', false, 'error', 'Cette invitation a déjà été utilisée.');
  end if;

  if v_invitation.expires_at <= now() then
    return jsonb_build_object('success', false, 'error', 'Cette invitation a expiré.');
  end if;

  -- Une invitation nominative ne vaut que pour l'adresse invitée. Sans ce
  -- contrôle, un lien transféré ouvrirait l'équipe à qui l'a reçu.
  if v_invitation.invitation_type = 'email' then
    select lower(email) into v_email from auth.users where id = v_user;

    if v_email is distinct from lower(v_invitation.email) then
      return jsonb_build_object(
        'success', false,
        'error', 'Cette invitation a été envoyée à une autre adresse e-mail.'
      );
    end if;
  end if;

  insert into papyrus.team_members (team_id, user_id, role)
  values (v_invitation.team_id, v_user, coalesce(v_invitation.role, 'member'))
  -- La clé primaire est (user_id, team_id) — dans cet ordre.
  on conflict (user_id, team_id) do nothing;

  -- Une invitation par lien reste ouverte : c'est ce qui la distingue d'une
  -- invitation nominative, et c'est pour cela qu'elle porte une date
  -- d'expiration. Une invitation nominative, elle, se referme.
  if v_invitation.invitation_type = 'email' then
    update papyrus.team_invitations
       set status = 'accepted', accepted_at = now(), accepted_by = v_user
     where id = invitation_id;
  end if;

  return jsonb_build_object('success', true, 'team_id', v_invitation.team_id);
end;
$$;

revoke all on function papyrus.accept_team_invitation(uuid) from public;
grant execute on function papyrus.accept_team_invitation(uuid) to authenticated, service_role;
