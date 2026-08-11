-- ============================================================================
-- Papyrus — schéma de référence (baseline)
--
-- POURQUOI UN SEUL FICHIER
-- Les migrations 001→014 d'origine décrivaient la base Supabase hébergée qui
-- accompagnait le déploiement Vercel. Cette base est abandonnée : Papyrus tourne
-- désormais sur le Supabase auto-hébergé du VPS. Les rejouer une par une aurait
-- consisté à créer des colonnes pour les supprimer trois fichiers plus loin, et
-- à recréer des policies RLS dont on sait qu'elles étaient trouées.
-- Elles restent consultables dans `_archive/` à titre d'historique.
--
-- POURQUOI UN SCHÉMA DÉDIÉ
-- Le schéma `public` de ce Supabase est partagé par une quinzaine d'applications
-- (jobs, candidates, companies, blog_posts…). Y créer des tables nommées `forms`,
-- `teams` ou `profiles` entrerait en collision. L'instance a déjà la convention
-- d'un schéma par application (`club`, `mooove_crm`) : Papyrus suit la même.
--
-- Ce fichier est idempotent : il peut être rejoué sans dommage.
-- ============================================================================

create schema if not exists papyrus;

-- PostgREST doit exposer ce schéma : ajouter `papyrus` à PGRST_DB_SCHEMAS dans
-- les variables du service Easypanel `supabase` (voir docs/DEPLOYMENT.md).
grant usage on schema papyrus to anon, authenticated, service_role;
alter default privileges in schema papyrus
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema papyrus
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema papyrus
  grant all on functions to anon, authenticated, service_role;

set search_path = papyrus, public;

create extension if not exists pgcrypto with schema extensions;

-- ============================================================================
-- 1. Identité et espaces de travail
-- ============================================================================

-- Un « espace de travail » dans l'interface = une ligne de `teams` en base.
create table if not exists papyrus.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free' check (plan in ('free', 'pro', 'team')),
  scope text not null default 'team' check (scope in ('personal', 'team')),
  -- L'espace personnel créé à l'inscription ne doit pas pouvoir être supprimé.
  is_deletable boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists papyrus.team_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references papyrus.teams(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member', 'reader')),
  joined_at timestamptz not null default now(),
  primary key (user_id, team_id)
);

create index if not exists idx_team_members_user on papyrus.team_members(user_id);
create index if not exists idx_team_members_team on papyrus.team_members(team_id);

-- Miroir consultable de auth.users : permet de retrouver quelqu'un par email
-- pour l'inviter, sans donner accès au schéma `auth`.
create table if not exists papyrus.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  first_name text,
  last_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 2. Formulaires
-- ============================================================================

create table if not exists papyrus.forms (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references papyrus.teams(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  title text not null default 'Nouveau formulaire',
  slug text unique not null,
  description text,
  display_mode text not null default 'sections'
    check (display_mode in ('scroll', 'sections', 'typeform')),
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  is_template boolean not null default false,
  template_origin_id uuid references papyrus.forms(id) on delete set null,
  scope text default 'personal' check (scope is null or scope in ('personal', 'workspace', 'global')),
  template_category text,
  template_description text,
  template_icon text,
  theme jsonb not null default
    '{"bg":"#EFF9FE","accent":"#052139","font":"Aktiv Grotesk","banner_url":null,"dark_mode":false}'::jsonb,
  access_type text not null default 'public' check (access_type in ('public', 'private', 'password')),
  access_password text,
  languages text[] not null default array['fr'],
  default_language text not null default 'fr',
  save_and_resume boolean not null default true,
  unique_email boolean not null default false,
  scoring_enabled boolean not null default false,
  show_score_to_respondent boolean not null default false,
  published_at timestamptz,
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_forms_team on papyrus.forms(team_id);
create index if not exists idx_forms_slug on papyrus.forms(slug);
create index if not exists idx_forms_status_team on papyrus.forms(status, team_id);

create table if not exists papyrus.fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references papyrus.forms(id) on delete cascade,
  type text not null check (type in (
    'short_text', 'long_text', 'email', 'phone', 'number', 'url',
    'single_choice', 'multiple_choice', 'dropdown', 'rating', 'nps',
    'date', 'file', 'section_break', 'statement', 'image', 'video', 'matrix'
  )),
  label jsonb not null default '{"fr":"Question"}'::jsonb,
  description jsonb not null default '{}'::jsonb,
  placeholder jsonb not null default '{}'::jsonb,
  -- Pour une matrice, `options` porte les colonnes et `rows` les lignes.
  options jsonb not null default '[]'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  -- Sous-questions appliquées à chaque option cochée d'un choix multiple.
  subfields jsonb not null default '[]'::jsonb,
  style jsonb not null default '{}'::jsonb,
  layout_width text default 'full' check (layout_width in ('full', 'half')),
  required boolean not null default false,
  hidden_by_default boolean not null default false,
  field_order int not null,
  validation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_fields_form_order on papyrus.fields(form_id, field_order);

create table if not exists papyrus.logic_rules (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references papyrus.forms(id) on delete cascade,
  conditions jsonb not null default '[]'::jsonb,
  conditions_operator text not null default 'AND' check (conditions_operator in ('AND', 'OR')),
  action_type text check (action_type in ('show_field', 'hide_field', 'jump_to', 'end_form')),
  target_field_id uuid references papyrus.fields(id) on delete cascade,
  rule_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_logic_form on papyrus.logic_rules(form_id);

-- ============================================================================
-- 3. Réponses
-- ============================================================================

create table if not exists papyrus.submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references papyrus.forms(id) on delete cascade,
  responses jsonb not null default '{}'::jsonb,
  respondent_language text not null default 'fr',
  -- Alimenté quand le formulaire comporte un champ email : support de l'option
  -- « un seul envoi par personne ».
  respondent_email text,
  -- Haché avec IP_HASH_SALT, jamais stockée en clair. Null si le sel est absent.
  ip_hash text,
  user_agent text,
  source text not null default 'papyrus' check (source in ('papyrus', 'tally_import')),
  -- Identifiant d'origine côté Tally, pour ne jamais importer deux fois.
  external_id text,
  completed_at timestamptz not null default now(),
  actions_triggered jsonb not null default '[]'::jsonb
);

create index if not exists idx_submissions_form_date on papyrus.submissions(form_id, completed_at);
create index if not exists idx_submissions_email
  on papyrus.submissions(form_id, respondent_email) where respondent_email is not null;
create unique index if not exists idx_submissions_external
  on papyrus.submissions(form_id, external_id) where external_id is not null;

-- ============================================================================
-- 4. Invitations
-- ============================================================================

create table if not exists papyrus.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references papyrus.teams(id) on delete cascade,
  invited_by uuid references auth.users(id) on delete set null,
  invitation_type text not null check (invitation_type in ('email', 'link')),
  email text,
  invite_token text unique,
  role text not null default 'member' check (role in ('admin', 'member', 'reader')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired')),
  expires_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint valid_invitation_data check (
    (invitation_type = 'email' and email is not null and invite_token is null) or
    (invitation_type = 'link' and email is null and invite_token is not null)
  )
);

create index if not exists idx_invitations_team on papyrus.team_invitations(team_id);
create index if not exists idx_invitations_email on papyrus.team_invitations(email);
create index if not exists idx_invitations_token on papyrus.team_invitations(invite_token);

-- ============================================================================
-- 5. Réglages d'instance et administration
-- ============================================================================

-- Table à ligne unique : qui a le droit de créer un compte.
create table if not exists papyrus.app_settings (
  id boolean primary key default true,
  allowed_email_domains text[] not null default array[]::text[],
  allow_public_signup boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint app_settings_singleton check (id)
);

insert into papyrus.app_settings (id) values (true) on conflict (id) do nothing;

create table if not exists papyrus.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null
);

-- ============================================================================
-- 6. Intégration Tally
-- ============================================================================

-- La clé API est chiffrée applicativement (AES-256-GCM, lib/crypto.ts) avant
-- insertion : un accès en lecture à la base ne suffit pas à la récupérer.
create table if not exists papyrus.tally_credentials (
  team_id uuid primary key references papyrus.teams(id) on delete cascade,
  encrypted_api_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists papyrus.tally_imports (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references papyrus.teams(id) on delete cascade,
  form_id uuid references papyrus.forms(id) on delete set null,
  tally_form_id text not null,
  tally_form_name text,
  imported_by uuid references auth.users(id) on delete set null,
  fields_imported int not null default 0,
  responses_imported int not null default 0,
  status text not null default 'success' check (status in ('success', 'partial', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_tally_imports_team on papyrus.tally_imports(team_id, created_at desc);

-- ============================================================================
-- 7. Fonctions utilitaires
--
-- `security definer` + `search_path` figé : indispensable pour éviter la
-- récursion infinie quand une policy de team_members interroge team_members.
-- ============================================================================

create or replace function papyrus.is_team_member(check_team_id uuid)
returns boolean language sql security definer stable
set search_path = papyrus, public
as $$
  select exists (
    select 1 from papyrus.team_members
    where user_id = auth.uid() and team_id = check_team_id
  );
$$;

create or replace function papyrus.is_team_admin(check_team_id uuid)
returns boolean language sql security definer stable
set search_path = papyrus, public
as $$
  select exists (
    select 1 from papyrus.team_members
    where user_id = auth.uid() and team_id = check_team_id and role = 'admin'
  );
$$;

create or replace function papyrus.is_app_admin()
returns boolean language sql security definer stable
set search_path = papyrus, public
as $$
  select exists (select 1 from papyrus.app_admins where user_id = auth.uid());
$$;

create or replace function papyrus.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_forms_updated_at on papyrus.forms;
create trigger trg_forms_updated_at before update on papyrus.forms
  for each row execute function papyrus.set_updated_at();

drop trigger if exists trg_profiles_updated_at on papyrus.profiles;
create trigger trg_profiles_updated_at before update on papyrus.profiles
  for each row execute function papyrus.set_updated_at();

-- ============================================================================
-- 8. Amorçage d'un nouveau compte
--
-- Ce trigger vit sur auth.users, partagé par toutes les applications de cette
-- instance Supabase. Il est donc écrit pour ne JAMAIS faire échouer une
-- inscription : toute erreur est avalée, sans quoi un problème dans Papyrus
-- empêcherait de créer un compte sur n'importe quelle autre app.
-- ============================================================================

create or replace function papyrus.handle_new_user()
returns trigger language plpgsql security definer
set search_path = papyrus, public
as $$
declare
  new_team_id uuid;
begin
  insert into papyrus.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  insert into papyrus.teams (name, scope, is_deletable, created_by)
  values ('Mon espace', 'personal', false, new.id)
  returning id into new_team_id;

  insert into papyrus.team_members (user_id, team_id, role)
  values (new.id, new_team_id, 'admin')
  on conflict do nothing;

  -- Le tout premier compte devient super-administrateur, sinon l'écran
  -- d'administration serait inaccessible après un déploiement neuf.
  if not exists (select 1 from papyrus.app_admins) then
    insert into papyrus.app_admins (user_id) values (new.id) on conflict do nothing;
  end if;

  return new;
exception when others then
  raise warning 'papyrus.handle_new_user a échoué pour %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_papyrus on auth.users;
create trigger on_auth_user_created_papyrus
  after insert on auth.users
  for each row execute function papyrus.handle_new_user();

-- ============================================================================
-- 9. Row Level Security
--
-- Principe : une policy par commande, jamais de `for all`. Sur une policy
-- `for all`, la clause USING régit aussi DELETE et UPDATE — c'est précisément
-- ce qui, dans le schéma d'origine, permettait à un visiteur anonyme de
-- supprimer les champs de n'importe quel formulaire publié.
-- ============================================================================

alter table papyrus.teams enable row level security;
alter table papyrus.team_members enable row level security;
alter table papyrus.profiles enable row level security;
alter table papyrus.forms enable row level security;
alter table papyrus.fields enable row level security;
alter table papyrus.logic_rules enable row level security;
alter table papyrus.submissions enable row level security;
alter table papyrus.team_invitations enable row level security;
alter table papyrus.app_settings enable row level security;
alter table papyrus.app_admins enable row level security;
alter table papyrus.tally_credentials enable row level security;
alter table papyrus.tally_imports enable row level security;

-- ---- TEAMS ----
drop policy if exists teams_select on papyrus.teams;
create policy teams_select on papyrus.teams for select
  using (papyrus.is_team_member(id));

drop policy if exists teams_insert on papyrus.teams;
create policy teams_insert on papyrus.teams for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists teams_update on papyrus.teams;
create policy teams_update on papyrus.teams for update
  using (papyrus.is_team_admin(id)) with check (papyrus.is_team_admin(id));

drop policy if exists teams_delete on papyrus.teams;
create policy teams_delete on papyrus.teams for delete
  using (papyrus.is_team_admin(id) and is_deletable);

-- ---- TEAM_MEMBERS ----
drop policy if exists team_members_select on papyrus.team_members;
create policy team_members_select on papyrus.team_members for select
  using (user_id = auth.uid() or papyrus.is_team_member(team_id));

-- Le créateur d'un espace doit pouvoir s'y rattacher : à cet instant précis
-- il n'est encore admin de rien.
drop policy if exists team_members_insert on papyrus.team_members;
create policy team_members_insert on papyrus.team_members for insert
  with check (
    papyrus.is_team_admin(team_id)
    or (user_id = auth.uid() and not exists (
      select 1 from papyrus.team_members existing where existing.team_id = team_members.team_id
    ))
  );

drop policy if exists team_members_update on papyrus.team_members;
create policy team_members_update on papyrus.team_members for update
  using (papyrus.is_team_admin(team_id)) with check (papyrus.is_team_admin(team_id));

drop policy if exists team_members_delete on papyrus.team_members;
create policy team_members_delete on papyrus.team_members for delete
  using (papyrus.is_team_admin(team_id) or user_id = auth.uid());

-- ---- PROFILES ----
-- Pas d'annuaire ouvert : on ne voit que soi-même et ses coéquipiers.
drop policy if exists profiles_select on papyrus.profiles;
create policy profiles_select on papyrus.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from papyrus.team_members mine
      join papyrus.team_members theirs on theirs.team_id = mine.team_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

drop policy if exists profiles_update on papyrus.profiles;
create policy profiles_update on papyrus.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---- FORMS ----
drop policy if exists forms_select on papyrus.forms;
create policy forms_select on papyrus.forms for select
  using (papyrus.is_team_member(team_id) or (is_template and scope = 'global'));

drop policy if exists forms_insert on papyrus.forms;
create policy forms_insert on papyrus.forms for insert
  with check (papyrus.is_team_member(team_id));

drop policy if exists forms_update on papyrus.forms;
create policy forms_update on papyrus.forms for update
  using (papyrus.is_team_member(team_id)) with check (papyrus.is_team_member(team_id));

drop policy if exists forms_delete on papyrus.forms;
create policy forms_delete on papyrus.forms for delete
  using (papyrus.is_team_member(team_id));

-- ---- FIELDS / LOGIC_RULES ----
-- La lecture anonyme passe par les vues `public_*` plus bas, jamais par ces
-- tables : c'est ce qui empêche un visiteur de les modifier.
drop policy if exists fields_select on papyrus.fields;
create policy fields_select on papyrus.fields for select
  using (exists (select 1 from papyrus.forms f where f.id = fields.form_id and papyrus.is_team_member(f.team_id)));

drop policy if exists fields_insert on papyrus.fields;
create policy fields_insert on papyrus.fields for insert
  with check (exists (select 1 from papyrus.forms f where f.id = fields.form_id and papyrus.is_team_member(f.team_id)));

drop policy if exists fields_update on papyrus.fields;
create policy fields_update on papyrus.fields for update
  using (exists (select 1 from papyrus.forms f where f.id = fields.form_id and papyrus.is_team_member(f.team_id)))
  with check (exists (select 1 from papyrus.forms f where f.id = fields.form_id and papyrus.is_team_member(f.team_id)));

drop policy if exists fields_delete on papyrus.fields;
create policy fields_delete on papyrus.fields for delete
  using (exists (select 1 from papyrus.forms f where f.id = fields.form_id and papyrus.is_team_member(f.team_id)));

drop policy if exists logic_select on papyrus.logic_rules;
create policy logic_select on papyrus.logic_rules for select
  using (exists (select 1 from papyrus.forms f where f.id = logic_rules.form_id and papyrus.is_team_member(f.team_id)));

drop policy if exists logic_insert on papyrus.logic_rules;
create policy logic_insert on papyrus.logic_rules for insert
  with check (exists (select 1 from papyrus.forms f where f.id = logic_rules.form_id and papyrus.is_team_member(f.team_id)));

drop policy if exists logic_update on papyrus.logic_rules;
create policy logic_update on papyrus.logic_rules for update
  using (exists (select 1 from papyrus.forms f where f.id = logic_rules.form_id and papyrus.is_team_member(f.team_id)))
  with check (exists (select 1 from papyrus.forms f where f.id = logic_rules.form_id and papyrus.is_team_member(f.team_id)));

drop policy if exists logic_delete on papyrus.logic_rules;
create policy logic_delete on papyrus.logic_rules for delete
  using (exists (select 1 from papyrus.forms f where f.id = logic_rules.form_id and papyrus.is_team_member(f.team_id)));

-- ---- SUBMISSIONS ----
-- Aucune policy INSERT : les réponses n'arrivent que par /api/submit/[slug],
-- qui valide les champs requis, applique un rate limit et hache l'IP.
drop policy if exists submissions_select on papyrus.submissions;
create policy submissions_select on papyrus.submissions for select
  using (exists (select 1 from papyrus.forms f where f.id = submissions.form_id and papyrus.is_team_member(f.team_id)));

drop policy if exists submissions_update on papyrus.submissions;
create policy submissions_update on papyrus.submissions for update
  using (exists (select 1 from papyrus.forms f where f.id = submissions.form_id and papyrus.is_team_member(f.team_id)))
  with check (exists (select 1 from papyrus.forms f where f.id = submissions.form_id and papyrus.is_team_member(f.team_id)));

drop policy if exists submissions_delete on papyrus.submissions;
create policy submissions_delete on papyrus.submissions for delete
  using (exists (select 1 from papyrus.forms f where f.id = submissions.form_id and papyrus.is_team_member(f.team_id)));

-- ---- INVITATIONS ----
drop policy if exists invitations_admin_all on papyrus.team_invitations;
create policy invitations_admin_all on papyrus.team_invitations for select
  using (papyrus.is_team_admin(team_id));

drop policy if exists invitations_own_email on papyrus.team_invitations;
create policy invitations_own_email on papyrus.team_invitations for select to authenticated
  using (invitation_type = 'email' and email = auth.jwt() ->> 'email');

-- ---- RÉGLAGES ----
-- Lecture seule côté client ; toute écriture passe par /api/admin/settings,
-- qui vérifie le statut de super-administrateur avec la clé service_role.
drop policy if exists app_settings_select on papyrus.app_settings;
create policy app_settings_select on papyrus.app_settings for select to authenticated using (true);

drop policy if exists app_admins_select on papyrus.app_admins;
create policy app_admins_select on papyrus.app_admins for select to authenticated
  using (papyrus.is_app_admin());

-- ---- TALLY ----
-- `tally_credentials` n'a volontairement aucune policy : la clé chiffrée n'est
-- lisible que par le serveur, via service_role.
drop policy if exists tally_imports_select on papyrus.tally_imports;
create policy tally_imports_select on papyrus.tally_imports for select
  using (papyrus.is_team_member(team_id));

-- ============================================================================
-- 10. Vues publiques — lecture anonyme des formulaires publiés
--
-- Un visiteur ne lit jamais les tables : il lit ces vues, qui filtrent sur le
-- statut et n'exposent aucune colonne sensible. `access_password` en
-- particulier ne sort jamais de la base.
-- ============================================================================

drop view if exists papyrus.public_forms cascade;
create view papyrus.public_forms as
  select
    id, team_id, title, slug, description, display_mode, status,
    theme, access_type, languages, default_language,
    save_and_resume, unique_email, scoring_enabled, show_score_to_respondent,
    published_at, closes_at, created_at, updated_at,
    (access_password is not null and access_password <> '') as requires_password
  from papyrus.forms
  where status = 'published' and (closes_at is null or closes_at > now());

drop view if exists papyrus.public_fields cascade;
create view papyrus.public_fields as
  select f.*
  from papyrus.fields f
  join papyrus.forms fo on fo.id = f.form_id
  where fo.status = 'published' and (fo.closes_at is null or fo.closes_at > now());

drop view if exists papyrus.public_logic_rules cascade;
create view papyrus.public_logic_rules as
  select l.*
  from papyrus.logic_rules l
  join papyrus.forms fo on fo.id = l.form_id
  where fo.status = 'published' and (fo.closes_at is null or fo.closes_at > now());

grant select on papyrus.public_forms to anon, authenticated;
grant select on papyrus.public_fields to anon, authenticated;
grant select on papyrus.public_logic_rules to anon, authenticated;

-- ============================================================================
-- 11. Stockage des pièces jointes non-média
--
-- Rappel de la règle Mooove : images et vidéos vont sur Cloudflare R2, jamais
-- ici. Ce bucket ne reçoit que des documents (PDF, DOCX, XLSX…).
-- Aucune policy INSERT : l'écriture passe exclusivement par
-- /api/uploads/document, qui authentifie l'appelant avant d'écrire.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('papyrus-documents', 'papyrus-documents', true, 26214400)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists "papyrus documents are readable" on storage.objects;
create policy "papyrus documents are readable" on storage.objects for select
  using (bucket_id = 'papyrus-documents');

-- ============================================================================
-- 12. Droits de table
-- ============================================================================

grant select, insert, update, delete on all tables in schema papyrus to authenticated;
grant select on all tables in schema papyrus to anon;
grant all on all tables in schema papyrus to service_role;
grant usage, select on all sequences in schema papyrus to authenticated, service_role;

-- Les secrets Tally restent hors de portée de tout rôle client.
revoke all on papyrus.tally_credentials from anon, authenticated;
