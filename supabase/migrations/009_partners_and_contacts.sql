-- ============================================================================
-- Papyrus — phase 6 : partenaires, portail et contacts
--
-- Un partenaire promeut un projet auprès de ses propres clients : il reçoit un
-- lien de partage, ses clients atterrissent sur une page à ses couleurs, et les
-- inscriptions qui en viennent lui rapportent une commission. Trois besoins qui
-- n'existent nulle part ailleurs dans Papyrus :
--
--   1. une identité extérieure à l'équipe — le partenaire n'est pas un membre,
--      il ne doit voir ni les formulaires, ni les autres partenaires, ni les
--      réponses qu'il n'a pas amenées ;
--   2. une attribution — savoir de quel lien vient chaque réponse, pour
--      toujours ;
--   3. un registre de commission — trois états, lisibles des deux côtés.
--
-- Trois décisions structurent ce fichier :
--
-- **L'identité partenaire est un compte Supabase Auth**, pas un couple
-- identifiant / mot de passe stocké à côté. mooove-invoice tient son propre
-- magasin d'identifiants ; le reproduire viderait la RLS de son sens, puisque
-- `auth.uid()` ne désignerait plus personne pour la moitié des visiteurs
-- authentifiés du produit.
--
-- **Un partenaire n'a AUCUNE policy sur les tables.** Il lit quatre vues, qui se
-- filtrent elles-mêmes sur ses identités (`current_partner_ids`), et il écrit
-- uniquement par des routes en `service_role` qui vérifient ses droits. La
-- surface à relire est donc de quatre vues, pas de six tables.
--
-- **Le partenaire ne voit pas les réponses au formulaire.** mooove-invoice les
-- lui montre en entier ; ici la vue `partner_registrations` n'expose que la
-- ligne — date, adresse, référence, montant, statut, commission. Un formulaire
-- d'inscription peut contenir un numéro de passeport ou une restriction
-- alimentaire : ce n'est pas l'affaire de l'apporteur d'affaires, et personne
-- n'aurait choisi cette exposition en la voyant écrite.
--
-- Ce fichier est idempotent : il peut être rejoué sans dommage.
-- ============================================================================

set search_path = papyrus, public;

-- ============================================================================
-- 1. Réglages du programme partenaire, portés par le projet
--
-- Sur le projet, pas sur le formulaire : un partenaire promeut un événement,
-- pas une question. C'est la règle de répartition posée en phase 1.
-- ============================================================================

alter table papyrus.projects
  add column if not exists partner_config jsonb not null default '{}'::jsonb,
  add column if not exists partner_join_token text;

-- Index partiel plutôt que contrainte `unique` sur la colonne : l'immense
-- majorité des projets n'a pas de lien d'auto-inscription, et l'index ne porte
-- alors que sur ceux qui en ont un.
create unique index if not exists projects_partner_join_token_key
  on papyrus.projects (partner_join_token)
  where partner_join_token is not null;

-- ============================================================================
-- 2. Annuaire des partenaires — au niveau de l'équipe
--
-- Un partenaire est créé une fois et garde son lien de portail pour toujours,
-- quel que soit le nombre de projets auxquels il participe ensuite. C'est ce qui
-- évite de lui réenvoyer des identifiants à chaque événement.
-- ============================================================================

create table if not exists papyrus.partners (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references papyrus.teams(id) on delete cascade,

  -- Le compte Supabase Auth qui ouvre le portail. Nul tant que l'invitation
  -- n'a pas été honorée : le partenaire existe dans l'annuaire avant d'avoir
  -- un compte, et le personnel doit pouvoir le préparer sans attendre.
  user_id uuid references auth.users(id) on delete set null,

  name text not null default '',
  email text not null default '',
  phone text not null default '',
  website text not null default '',
  -- Toujours une URL R2 : jamais de data URL. mooove-invoice en abuse, et un
  -- logo encodé en base64 se recharge en entier à chaque ligne de liste.
  logo_url text not null default '',
  notes text not null default '',
  status text not null default 'active' check (status in ('active', 'disabled')),

  -- Lien personnel permanent : /p/<portal_token>. Il désigne DE QUI c'est le
  -- portail ; c'est la session qui donne le droit d'y entrer. Connaître le lien
  -- de quelqu'un d'autre n'ouvre donc rien.
  portal_token text not null unique default replace(gen_random_uuid()::text, '-', ''),

  invited_at timestamptz,
  last_seen_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Une adresse par équipe : deux fiches pour la même personne produiraient deux
-- portails, et la moitié des commissions dans chacun.
create unique index if not exists partners_team_email_key
  on papyrus.partners (team_id, lower(email))
  where email <> '';

-- La même personne peut être partenaire de plusieurs équipes — un seul compte,
-- une fiche par équipe. L'unicité est donc par équipe, jamais globale.
create unique index if not exists partners_team_user_key
  on papyrus.partners (team_id, user_id)
  where user_id is not null;

create index if not exists partners_user_idx on papyrus.partners (user_id);

alter table papyrus.partners enable row level security;

drop policy if exists partners_select on papyrus.partners;
create policy partners_select on papyrus.partners for select
  using (papyrus.is_team_member(team_id));

drop policy if exists partners_insert on papyrus.partners;
create policy partners_insert on papyrus.partners for insert
  with check (papyrus.is_team_member(team_id));

drop policy if exists partners_update on papyrus.partners;
create policy partners_update on papyrus.partners for update
  using (papyrus.is_team_member(team_id))
  with check (papyrus.is_team_member(team_id));

drop policy if exists partners_delete on papyrus.partners;
create policy partners_delete on papyrus.partners for delete
  using (papyrus.is_team_member(team_id));

drop trigger if exists trg_partners_updated_at on papyrus.partners;
create trigger trg_partners_updated_at before update on papyrus.partners
  for each row execute function papyrus.set_updated_at();

-- ============================================================================
-- 3. Participation d'un partenaire à un projet
--
-- C'est cette ligne qui porte le lien public /a/<code> et à laquelle les
-- réponses sont rattachées. Un partenaire ne participe qu'une fois à un projet :
-- deux liens pour le même couple diviseraient ses propres statistiques.
-- ============================================================================

create table if not exists papyrus.project_partners (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references papyrus.projects(id) on delete cascade,
  partner_id uuid not null references papyrus.partners(id) on delete cascade,

  -- Slug public du lien de partage. Lisible et prononçable : il est collé dans
  -- des e-mails et lu au téléphone.
  code text not null unique,

  status text not null default 'active' check (status in ('active', 'disabled')),

  -- Total courant des visites de la landing. Les lignes de `partner_clicks`
  -- restent à côté pour l'historique ; ce compteur évite un `count(*)` sur
  -- chaque affichage de liste.
  click_count integer not null default 0,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, partner_id)
);

create index if not exists project_partners_project_idx
  on papyrus.project_partners (project_id);
create index if not exists project_partners_partner_idx
  on papyrus.project_partners (partner_id);

alter table papyrus.project_partners enable row level security;

-- Les quatre policies passent par le projet : l'appartenance à l'espace de
-- travail se lit toujours au même endroit.
drop policy if exists project_partners_select on papyrus.project_partners;
create policy project_partners_select on papyrus.project_partners for select
  using (exists (
    select 1 from papyrus.projects p
    where p.id = project_partners.project_id and papyrus.is_team_member(p.team_id)
  ));

drop policy if exists project_partners_insert on papyrus.project_partners;
create policy project_partners_insert on papyrus.project_partners for insert
  with check (exists (
    select 1 from papyrus.projects p
    where p.id = project_partners.project_id and papyrus.is_team_member(p.team_id)
  ));

drop policy if exists project_partners_update on papyrus.project_partners;
create policy project_partners_update on papyrus.project_partners for update
  using (exists (
    select 1 from papyrus.projects p
    where p.id = project_partners.project_id and papyrus.is_team_member(p.team_id)
  ))
  with check (exists (
    select 1 from papyrus.projects p
    where p.id = project_partners.project_id and papyrus.is_team_member(p.team_id)
  ));

drop policy if exists project_partners_delete on papyrus.project_partners;
create policy project_partners_delete on papyrus.project_partners for delete
  using (exists (
    select 1 from papyrus.projects p
    where p.id = project_partners.project_id and papyrus.is_team_member(p.team_id)
  ));

drop trigger if exists trg_project_partners_updated_at on papyrus.project_partners;
create trigger trg_project_partners_updated_at before update on papyrus.project_partners
  for each row execute function papyrus.set_updated_at();

-- ============================================================================
-- 4. Visites de la landing
--
-- L'adresse IP n'est PAS conservée. mooove-invoice la stocke en clair ; elle ne
-- sert qu'à dédoublonner, et un hachage salé le fait aussi bien sans constituer
-- un fichier d'adresses. `window_start` est le début de la fenêtre de trente
-- minutes : l'unicité (lien, visiteur, fenêtre) rend le dédoublonnage atomique
-- plutôt que « lire, décider, écrire » — deux onglets ouverts en même temps ne
-- comptent donc pas deux fois.
-- ============================================================================

create table if not exists papyrus.partner_clicks (
  id uuid primary key default gen_random_uuid(),
  project_partner_id uuid not null references papyrus.project_partners(id) on delete cascade,
  visitor_hash text not null default '',
  window_start timestamptz not null default date_trunc('hour', now()),
  user_agent text not null default '',
  created_at timestamptz not null default now(),

  unique (project_partner_id, visitor_hash, window_start)
);

create index if not exists partner_clicks_link_date_idx
  on papyrus.partner_clicks (project_partner_id, created_at desc);

alter table papyrus.partner_clicks enable row level security;

-- Lecture seule pour l'équipe. L'écriture vient de la page publique, donc de
-- `service_role` : aucune policy d'insertion, exactement comme `submissions`.
drop policy if exists partner_clicks_select on papyrus.partner_clicks;
create policy partner_clicks_select on papyrus.partner_clicks for select
  using (exists (
    select 1
    from papyrus.project_partners pp
    join papyrus.projects p on p.id = pp.project_id
    where pp.id = partner_clicks.project_partner_id and papyrus.is_team_member(p.team_id)
  ));

drop policy if exists partner_clicks_delete on papyrus.partner_clicks;
create policy partner_clicks_delete on papyrus.partner_clicks for delete
  using (exists (
    select 1
    from papyrus.project_partners pp
    join papyrus.projects p on p.id = pp.project_id
    where pp.id = partner_clicks.project_partner_id and papyrus.is_team_member(p.team_id)
  ));

-- ============================================================================
-- 5. Attribution et commission sur les réponses
-- ============================================================================

alter table papyrus.submissions
  -- `set null` et non `cascade` : supprimer un lien partenaire ne doit jamais
  -- emporter des inscriptions payées. La réponse perd son attribution, pas son
  -- existence.
  add column if not exists project_partner_id uuid
    references papyrus.project_partners(id) on delete set null,
  add column if not exists commission_paid_at timestamptz,
  add column if not exists commission_paid_by text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'submissions_commission_paid_by_check'
  ) then
    alter table papyrus.submissions
      add constraint submissions_commission_paid_by_check
      check (commission_paid_by in ('', 'partner', 'staff'));
  end if;
end $$;

create index if not exists submissions_partner_idx
  on papyrus.submissions (project_partner_id)
  where project_partner_id is not null;

-- ============================================================================
-- 6. Contacts
--
-- Un contact est l'après-vie d'une réponse : la personne reste joignable quand
-- le projet, lui, est terminé. `project_name` est dénormalisé exprès — un
-- contact doit survivre à la suppression de son projet en gardant la trace d'où
-- il vient.
-- ============================================================================

create table if not exists papyrus.contacts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references papyrus.teams(id) on delete cascade,
  project_id uuid references papyrus.projects(id) on delete set null,
  project_name text not null default '',
  submission_id uuid references papyrus.submissions(id) on delete set null,

  name text not null default '',
  email text not null default '',
  phone text not null default '',
  company text not null default '',
  language text not null default '',
  notes text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dédoublonnage par projet et par adresse : la même personne inscrite à deux
-- événements donne deux contacts, parce que ce sont deux relations distinctes,
-- mais deux inscriptions au même événement n'en donnent qu'un.
create unique index if not exists contacts_project_email_key
  on papyrus.contacts (project_id, lower(email))
  where email <> '' and project_id is not null;

create index if not exists contacts_team_idx on papyrus.contacts (team_id, created_at desc);
create index if not exists contacts_email_idx on papyrus.contacts (lower(email));

alter table papyrus.contacts enable row level security;

drop policy if exists contacts_select on papyrus.contacts;
create policy contacts_select on papyrus.contacts for select
  using (papyrus.is_team_member(team_id));

drop policy if exists contacts_insert on papyrus.contacts;
create policy contacts_insert on papyrus.contacts for insert
  with check (papyrus.is_team_member(team_id));

drop policy if exists contacts_update on papyrus.contacts;
create policy contacts_update on papyrus.contacts for update
  using (papyrus.is_team_member(team_id))
  with check (papyrus.is_team_member(team_id));

drop policy if exists contacts_delete on papyrus.contacts;
create policy contacts_delete on papyrus.contacts for delete
  using (papyrus.is_team_member(team_id));

drop trigger if exists trg_contacts_updated_at on papyrus.contacts;
create trigger trg_contacts_updated_at before update on papyrus.contacts
  for each row execute function papyrus.set_updated_at();

-- ============================================================================
-- 7. Droits de table
--
-- Explicites, et non hérités des `alter default privileges` de la migration 001 :
-- ceux-ci ne valent que pour les objets créés par le rôle qui les a posés, et
-- ces tables-ci sont créées par `supabase_admin`. Sans ces lignes, les quatre
-- tables sont invisibles de l'application entière — la RLS n'y est même pas
-- consultée, puisqu'il n'y a aucun droit à filtrer.
--
-- `partner_clicks` ne reçoit pas `insert` : les visites sont écrites depuis la
-- page publique, donc par `service_role`, comme les réponses.
-- ============================================================================

grant select, insert, update, delete on papyrus.partners to authenticated;
grant select, insert, update, delete on papyrus.project_partners to authenticated;
grant select, insert, update, delete on papyrus.contacts to authenticated;
grant select, delete on papyrus.partner_clicks to authenticated;

grant all on papyrus.partners to service_role;
grant all on papyrus.project_partners to service_role;
grant all on papyrus.contacts to service_role;
grant all on papyrus.partner_clicks to service_role;

-- ============================================================================
-- 8. Qui suis-je, côté partenaire ?
--
-- `setof uuid` et non `uuid` : la même personne peut être partenaire de
-- plusieurs équipes. Renvoyer une seule ligne ferait disparaître la moitié de
-- ses projets — sans erreur, sans trace, et seulement pour les rares partenaires
-- concernés, c'est-à-dire le défaut le plus difficile à voir.
-- ============================================================================

-- Incrément du compteur de visites.
--
-- Une fonction plutôt qu'un `update` depuis l'application : `click_count = x + 1`
-- lu puis écrit par deux visiteurs simultanés perd une visite à chaque fois. Ici
-- l'incrément est fait par la base, sous verrou de ligne.
create or replace function papyrus.increment_partner_clicks(p_link uuid)
returns void
language sql security definer
set search_path = papyrus, public
as $$
  update papyrus.project_partners
     set click_count = click_count + 1
   where id = p_link;
$$;

revoke all on function papyrus.increment_partner_clicks(uuid) from public;
grant execute on function papyrus.increment_partner_clicks(uuid) to service_role;

create or replace function papyrus.current_partner_ids()
returns setof uuid
language sql security definer stable
set search_path = papyrus, public
as $$
  select id from papyrus.partners
   where user_id = auth.uid() and status = 'active';
$$;

-- ============================================================================
-- 9. Vues publiques et vues partenaire
--
-- Même mécanique que `public_forms` : une vue appartenant au propriétaire du
-- schéma, donc lue sans RLS, mais qui ne sélectionne que des colonnes sans
-- danger et se filtre elle-même. Ni `portal_token`, ni `email`, ni `notes`
-- n'apparaissent dans la vue anonyme.
-- ============================================================================

drop view if exists papyrus.public_partner_links cascade;
create view papyrus.public_partner_links as
  select
    pp.id,
    pp.code,
    pp.project_id,
    pr.name as project_name,
    pr.languages,
    pr.default_language,
    pr.theme as project_theme,
    pr.partner_config,
    p.name as partner_name,
    p.logo_url as partner_logo_url,
    p.website as partner_website,
    f.slug as form_slug,
    f.title as form_title
  from papyrus.project_partners pp
  join papyrus.partners p on p.id = pp.partner_id
  join papyrus.projects pr on pr.id = pp.project_id
  -- Le formulaire promu : celui que le projet désigne, à défaut le plus ancien
  -- formulaire publié. Résolu ici et non dans l'application, parce que le rôle
  -- `anon` n'a pas le droit de lire `forms`.
  left join lateral (
    select f2.slug, f2.title
    from papyrus.forms f2
    where f2.project_id = pr.id
      and f2.status = 'published'
    order by (f2.id::text = coalesce(pr.partner_config ->> 'form_id', '')) desc,
             f2.created_at asc
    limit 1
  ) f on true
  where pp.status = 'active'
    and p.status = 'active'
    and pr.status = 'active'
    and (pr.partner_config ->> 'enabled') = 'true';

grant select on papyrus.public_partner_links to anon, authenticated;

-- Page publique d'auto-inscription : /a/join/<token>. Elle ne dit rien du projet
-- au-delà de son nom et du texte d'accueil.
drop view if exists papyrus.public_partner_join cascade;
create view papyrus.public_partner_join as
  select
    pr.id as project_id,
    pr.partner_join_token as token,
    pr.name as project_name,
    pr.default_language,
    pr.languages,
    pr.theme as project_theme,
    pr.partner_config
  from papyrus.projects pr
  where pr.status = 'active'
    and pr.partner_join_token is not null
    and (pr.partner_config ->> 'enabled') = 'true'
    and (pr.partner_config ->> 'self_register') = 'true';

grant select on papyrus.public_partner_join to anon, authenticated;

-- Les participations du partenaire connecté.
drop view if exists papyrus.partner_portal_links cascade;
create view papyrus.partner_portal_links as
  select
    pp.id,
    pp.partner_id,
    pp.project_id,
    pp.code,
    pp.status,
    pp.click_count,
    pp.created_at,
    pr.name as project_name,
    pr.status as project_status,
    pr.pricing as project_pricing,
    pr.partner_config,
    f.slug as form_slug,
    f.title as form_title
  from papyrus.project_partners pp
  join papyrus.projects pr on pr.id = pp.project_id
  left join lateral (
    select f2.slug, f2.title
    from papyrus.forms f2
    where f2.project_id = pr.id
      and f2.status = 'published'
    order by (f2.id::text = coalesce(pr.partner_config ->> 'form_id', '')) desc,
             f2.created_at asc
    limit 1
  ) f on true
  where pp.partner_id in (select papyrus.current_partner_ids());

grant select on papyrus.partner_portal_links to authenticated;

-- Les inscriptions amenées par le partenaire connecté.
--
-- Pas de `responses` : voir l'en-tête du fichier. Le taux de commission est
-- résolu ici pour que la ligne se suffise à elle-même, dans le même esprit que
-- l'instantané de prix de la phase 3.
drop view if exists papyrus.partner_registrations cascade;
create view papyrus.partner_registrations as
  select
    s.id,
    pp.id as project_partner_id,
    pp.partner_id,
    pp.project_id,
    s.completed_at,
    s.respondent_email,
    s.respondent_language,
    s.status,
    s.invoice_number,
    s.pricing,
    s.commission_paid_at,
    s.commission_paid_by,
    coalesce(
      nullif(pr.partner_config ->> 'commission_percent', ''),
      '0'
    )::numeric as commission_percent
  from papyrus.submissions s
  join papyrus.project_partners pp on pp.id = s.project_partner_id
  join papyrus.projects pr on pr.id = pp.project_id
  where not s.is_partial
    and pp.partner_id in (select papyrus.current_partner_ids());

grant select on papyrus.partner_registrations to authenticated;

-- Les projets que le partenaire connecté peut rejoindre : programme ouvert,
-- formulaire publié, et pas déjà rejoint.
drop view if exists papyrus.partner_open_projects cascade;
create view papyrus.partner_open_projects as
  select
    pr.id as project_id,
    me.id as partner_id,
    pr.name as project_name,
    pr.partner_config
  from papyrus.projects pr
  join papyrus.partners me
    on me.team_id = pr.team_id
   and me.id in (select papyrus.current_partner_ids())
  where pr.status = 'active'
    and (pr.partner_config ->> 'enabled') = 'true'
    and exists (
      select 1 from papyrus.forms f
      where f.project_id = pr.id and f.status = 'published'
    )
    and not exists (
      select 1 from papyrus.project_partners pp
      where pp.project_id = pr.id and pp.partner_id = me.id
    );

grant select on papyrus.partner_open_projects to authenticated;

notify pgrst, 'reload schema';
