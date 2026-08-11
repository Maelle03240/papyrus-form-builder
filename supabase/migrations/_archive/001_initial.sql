-- ============================================================================
-- Papyrus — Migration initiale (V1 fondations)
-- Schéma : équipes, formulaires, champs, logique, destinations, actions, IA
-- ============================================================================

-- Extensions
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Équipes
-- ----------------------------------------------------------------------------
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text default 'free',
  created_at timestamptz default now()
);

create table if not exists team_members (
  user_id uuid references auth.users(id) on delete cascade,
  team_id uuid references teams(id) on delete cascade,
  role text check (role in ('admin','member')) default 'member',
  joined_at timestamptz default now(),
  primary key (user_id, team_id)
);

-- ----------------------------------------------------------------------------
-- Formulaires
-- ----------------------------------------------------------------------------
create table if not exists forms (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  created_by uuid references auth.users(id),
  title text not null default 'Nouveau formulaire',
  slug text unique not null,
  description text,
  display_mode text check (display_mode in ('scroll','typeform')) default 'scroll',
  status text check (status in ('draft','published','closed')) default 'draft',
  is_template boolean default false,
  template_origin_id uuid references forms(id),
  theme jsonb default '{"bg":"#F7F0DC","accent":"#052139","font":"Aktiv Grotesk","banner_url":null,"dark_mode":false}',
  access_type text check (access_type in ('public','private','password')) default 'public',
  access_password text,
  languages text[] default array['fr'],
  default_language text default 'fr',
  published_at timestamptz,
  closes_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid references forms(id) on delete cascade,
  type text check (type in (
    'short_text','long_text','email','phone','number',
    'single_choice','multiple_choice','dropdown','rating',
    'nps','date','file','section_break','statement'
  )) not null,
  label jsonb not null default '{"fr":"Question"}',
  description jsonb default '{}',
  placeholder jsonb default '{}',
  options jsonb default '[]',
  required boolean default false,
  field_order int not null,
  validation jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists logic_rules (
  id uuid primary key default gen_random_uuid(),
  form_id uuid references forms(id) on delete cascade,
  source_field_id uuid references fields(id) on delete cascade,
  condition text check (condition in ('equals','not_equals','contains','greater_than','less_than')),
  condition_value text not null,
  action_type text check (action_type in ('show_field','hide_field','jump_to','end_form')),
  target_field_id uuid references fields(id),
  rule_order int default 0,
  created_at timestamptz default now()
);

create table if not exists form_destinations (
  id uuid primary key default gen_random_uuid(),
  form_id uuid references forms(id) on delete cascade,
  type text check (type in ('supabase','airtable','google_sheets')) not null,
  config jsonb not null default '{}',
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists form_actions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid references forms(id) on delete cascade,
  type text check (type in ('webhook','rest_api','email')) not null,
  name text not null,
  config jsonb not null default '{}',
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists charts (
  id uuid primary key default gen_random_uuid(),
  form_id uuid references forms(id) on delete cascade,
  field_id uuid references fields(id),
  type text check (type in ('bar','pie','line','number','word_cloud','table')),
  title text,
  config jsonb default '{}',
  ai_generated boolean default true,
  display_order int default 0,
  created_at timestamptz default now()
);

create table if not exists field_translations (
  id uuid primary key default gen_random_uuid(),
  form_id uuid references forms(id) on delete cascade,
  language text not null,
  translations jsonb not null default '{}',
  ai_generated boolean default true,
  manually_reviewed boolean default false,
  created_at timestamptz default now(),
  unique(form_id, language)
);

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid references forms(id) on delete cascade,
  respondent_language text default 'fr',
  ip_hash text,
  user_agent text,
  completed_at timestamptz default now(),
  actions_triggered jsonb default '[]'
);

-- ----------------------------------------------------------------------------
-- Index performance
-- ----------------------------------------------------------------------------
create index if not exists idx_fields_form_order on fields(form_id, field_order);
create index if not exists idx_logic_form on logic_rules(form_id);
create index if not exists idx_submissions_form_date on submissions(form_id, completed_at);
create index if not exists idx_forms_team on forms(team_id);
create index if not exists idx_team_members_user on team_members(user_id);

-- ----------------------------------------------------------------------------
-- Trigger updated_at
-- ----------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_forms_updated_at on forms;
create trigger trg_forms_updated_at before update on forms
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- Helper: vérifier appartenance équipe (évite récursivité dans RLS)
-- ----------------------------------------------------------------------------
create or replace function is_team_member(check_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from team_members
    where user_id = auth.uid() and team_id = check_team_id
  );
$$;

-- ----------------------------------------------------------------------------
-- RLS — Row Level Security
-- ----------------------------------------------------------------------------
alter table teams enable row level security;
alter table team_members enable row level security;
alter table forms enable row level security;
alter table fields enable row level security;
alter table logic_rules enable row level security;
alter table form_destinations enable row level security;
alter table form_actions enable row level security;
alter table charts enable row level security;
alter table field_translations enable row level security;
alter table submissions enable row level security;

-- TEAMS
drop policy if exists "members can read their teams" on teams;
create policy "members can read their teams" on teams for select
  using (is_team_member(id));

drop policy if exists "authenticated users can create a team" on teams;
create policy "authenticated users can create a team" on teams for insert
  with check (auth.uid() is not null);

-- TEAM MEMBERS
drop policy if exists "users can see their own memberships" on team_members;
create policy "users can see their own memberships" on team_members for select
  using (user_id = auth.uid() or is_team_member(team_id));

drop policy if exists "admins manage members" on team_members;
create policy "admins manage members" on team_members for all
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = team_members.team_id
        and tm.user_id = auth.uid()
        and tm.role = 'admin'
    )
  );

-- FORMS
drop policy if exists "team members read forms" on forms;
create policy "team members read forms" on forms for select
  using (is_team_member(team_id));

drop policy if exists "team members write forms" on forms;
create policy "team members write forms" on forms for all
  using (is_team_member(team_id))
  with check (is_team_member(team_id));

-- Lecture publique des formulaires publiés (pour /f/[slug])
drop policy if exists "anyone can read published forms" on forms;
create policy "anyone can read published forms" on forms for select
  using (status = 'published');

-- FIELDS — héritent de l'accès au formulaire
drop policy if exists "fields follow form access" on fields;
create policy "fields follow form access" on fields for all
  using (
    exists (
      select 1 from forms f
      where f.id = fields.form_id
        and (is_team_member(f.team_id) or f.status = 'published')
    )
  )
  with check (
    exists (
      select 1 from forms f
      where f.id = fields.form_id and is_team_member(f.team_id)
    )
  );

-- LOGIC RULES
drop policy if exists "logic follows form access" on logic_rules;
create policy "logic follows form access" on logic_rules for all
  using (
    exists (
      select 1 from forms f
      where f.id = logic_rules.form_id
        and (is_team_member(f.team_id) or f.status = 'published')
    )
  )
  with check (
    exists (
      select 1 from forms f
      where f.id = logic_rules.form_id and is_team_member(f.team_id)
    )
  );

-- DESTINATIONS / ACTIONS / CHARTS / TRANSLATIONS — réservés à l'équipe
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'form_destinations', 'form_actions', 'charts', 'field_translations'
  ]) loop
    execute format($f$
      drop policy if exists "%1$s_team_only" on %1$s;
      create policy "%1$s_team_only" on %1$s for all
        using (
          exists (
            select 1 from forms f
            where f.id = %1$s.form_id and is_team_member(f.team_id)
          )
        )
        with check (
          exists (
            select 1 from forms f
            where f.id = %1$s.form_id and is_team_member(f.team_id)
          )
        );
    $f$, t);
  end loop;
end $$;

-- SUBMISSIONS — équipe lit, public crée
drop policy if exists "team reads submissions" on submissions;
create policy "team reads submissions" on submissions for select
  using (
    exists (
      select 1 from forms f
      where f.id = submissions.form_id and is_team_member(f.team_id)
    )
  );

drop policy if exists "anyone submits to published forms" on submissions;
create policy "anyone submits to published forms" on submissions for insert
  with check (
    exists (
      select 1 from forms f
      where f.id = submissions.form_id and f.status = 'published'
    )
  );

-- ----------------------------------------------------------------------------
-- Bootstrap: création automatique d'une équipe à l'inscription
-- ----------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_team_id uuid;
begin
  insert into teams (name) values (coalesce(new.raw_user_meta_data->>'team_name', 'Mon équipe'))
  returning id into new_team_id;

  insert into team_members (user_id, team_id, role)
  values (new.id, new_team_id, 'admin');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
