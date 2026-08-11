-- ============================================================================
-- Papyrus — Migration 013 : Espaces de travail, réglages d'instance, Tally
--
-- Trois ajouts :
--   1. `teams` devient le support réel des « espaces de travail » de l'interface
--      (jusqu'ici stockés dans le localStorage du navigateur, donc perdus d'un
--      poste à l'autre et invisibles pour les autres membres).
--   2. `app_settings` : réglages d'instance, dont la liste des domaines email
--      autorisés à créer un compte.
--   3. `tally_credentials` + `tally_imports` : import de formulaires Tally.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TEAMS = espaces de travail
-- ----------------------------------------------------------------------------

alter table teams
  add column if not exists scope text
    check (scope in ('personal', 'team')) default 'team',
  add column if not exists is_deletable boolean default true,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- L'espace personnel créé automatiquement à l'inscription n'est pas supprimable.
update teams set scope = 'personal', is_deletable = false
where name in ('Mon espace', 'Mon équipe') and scope is distinct from 'personal';

create index if not exists idx_teams_created_by on teams(created_by);

-- Un membre peut aussi être simple lecteur : l'interface proposait déjà le rôle
-- « Lecteur » alors que la contrainte CHECK ne l'acceptait pas — tout ajout de
-- lecteur échouait donc silencieusement.
alter table team_members drop constraint if exists team_members_role_check;
alter table team_members add constraint team_members_role_check
  check (role in ('admin', 'member', 'reader'));

alter table team_invitations drop constraint if exists team_invitations_role_check;
alter table team_invitations add constraint team_invitations_role_check
  check (role in ('admin', 'member', 'reader'));

-- Les membres doivent pouvoir créer un espace et le renommer s'ils en sont admin.
drop policy if exists "authenticated users can create a team" on teams;
create policy "authenticated users can create a team" on teams for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists "admins update their team" on teams;
create policy "admins update their team" on teams for update
  using (is_team_admin(id))
  with check (is_team_admin(id));

drop policy if exists "admins delete deletable teams" on teams;
create policy "admins delete deletable teams" on teams for delete
  using (is_team_admin(id) and is_deletable);

-- ----------------------------------------------------------------------------
-- 2. APP_SETTINGS — réglages d'instance (une seule ligne)
--
-- `allowed_email_domains` pilote qui peut créer un compte. Liste vide = aucune
-- restriction. Le contrôle est appliqué à la connexion, côté serveur.
-- ----------------------------------------------------------------------------

create table if not exists app_settings (
  id boolean primary key default true,
  allowed_email_domains text[] not null default array[]::text[],
  -- Si faux, seules les personnes déjà invitées peuvent se connecter.
  allow_public_signup boolean not null default true,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id) on delete set null,
  -- Garantit qu'il n'existe qu'une seule ligne de configuration.
  constraint app_settings_singleton check (id)
);

insert into app_settings (id) values (true) on conflict (id) do nothing;

alter table app_settings enable row level security;

-- Tout le monde (connecté) peut lire les réglages pour afficher l'écran admin ;
-- seuls les super-admins écrivent, ce qui est vérifié côté serveur.
drop policy if exists "authenticated read app settings" on app_settings;
create policy "authenticated read app settings" on app_settings for select
  to authenticated using (true);

-- Aucune policy d'écriture : les mises à jour passent par /api/admin/settings
-- avec la clé service_role, après vérification du rôle super-admin.

-- ----------------------------------------------------------------------------
-- 3. Super-admins — qui peut modifier les réglages d'instance
-- ----------------------------------------------------------------------------

create table if not exists app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz default now(),
  granted_by uuid references auth.users(id) on delete set null
);

alter table app_admins enable row level security;

drop policy if exists "admins read admin list" on app_admins;
create policy "admins read admin list" on app_admins for select
  to authenticated
  using (exists (select 1 from app_admins a where a.user_id = auth.uid()));

create or replace function is_app_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;

-- Amorçage : le tout premier compte créé devient super-admin, sinon personne ne
-- pourrait ouvrir l'écran d'administration après un déploiement neuf.
create or replace function bootstrap_first_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from app_admins) then
    insert into app_admins (user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_bootstrap_admin on auth.users;
create trigger on_auth_user_bootstrap_admin
  after insert on auth.users
  for each row execute function bootstrap_first_admin();

-- ----------------------------------------------------------------------------
-- 4. TALLY — identifiants et journal d'import
--
-- La clé API est chiffrée applicativement avant insertion (voir lib/crypto.ts) :
-- même avec un accès en lecture à la base, la valeur reste inexploitable sans
-- APP_ENCRYPTION_KEY, qui vit uniquement dans l'environnement Easypanel.
-- ----------------------------------------------------------------------------

create table if not exists tally_credentials (
  team_id uuid primary key references teams(id) on delete cascade,
  encrypted_api_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table tally_credentials enable row level security;

-- Aucune policy : la clé n'est jamais lue par un client. Seul le serveur y
-- accède, via service_role, après avoir vérifié que l'appelant est admin de l'équipe.

create table if not exists tally_imports (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade not null,
  form_id uuid references forms(id) on delete set null,
  tally_form_id text not null,
  tally_form_name text,
  imported_by uuid references auth.users(id) on delete set null,
  fields_imported int default 0,
  responses_imported int default 0,
  status text check (status in ('success', 'partial', 'failed')) default 'success',
  error_message text,
  created_at timestamptz default now()
);

create index if not exists idx_tally_imports_team on tally_imports(team_id, created_at desc);

alter table tally_imports enable row level security;

drop policy if exists "team reads its tally imports" on tally_imports;
create policy "team reads its tally imports" on tally_imports for select
  using (is_team_member(team_id));

-- ----------------------------------------------------------------------------
-- 5. SUBMISSIONS — origine d'une réponse
--
-- Distingue les réponses collectées par Papyrus de celles importées depuis Tally,
-- pour que les statistiques restent lisibles après une migration.
-- ----------------------------------------------------------------------------

alter table submissions
  add column if not exists source text
    check (source in ('papyrus', 'tally_import')) default 'papyrus',
  add column if not exists external_id text,
  -- Nécessaire pour l'option « un seul envoi par personne » : sans cette colonne,
  -- le contrôle d'unicité n'avait aucun support en base et ne s'appliquait jamais.
  add column if not exists respondent_email text;

create index if not exists idx_submissions_email
  on submissions(form_id, respondent_email)
  where respondent_email is not null;

-- Empêche de réimporter deux fois la même réponse Tally.
create unique index if not exists idx_submissions_external
  on submissions(form_id, external_id)
  where external_id is not null;
