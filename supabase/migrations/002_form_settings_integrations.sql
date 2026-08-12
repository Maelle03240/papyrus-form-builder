-- ============================================================================
-- Papyrus — réglages par formulaire, réponses partielles et intégrations
--
-- Trois ajouts, tous idempotents :
--
--  1. `forms.settings` / `forms.notification_settings` — les options que Tally
--     range dans son onglet Settings. Deux colonnes plutôt qu'une seule : la
--     première est exposée à la vue publique (barre de progression, redirection,
--     message de clôture…), la seconde ne doit JAMAIS l'être — elle contient les
--     adresses de notification et le corps des emails.
--
--  2. Réponses partielles — `submissions.is_partial` + `session_id`. Une réponse
--     partielle est une ligne écrite au fil de la saisie, remplacée en place au
--     moment de l'envoi définitif. L'index unique sur (form_id, session_id)
--     garantit qu'un répondant n'en crée qu'une.
--
--  3. Intégrations — jeton Google chiffré par espace de travail, configuration
--     par formulaire, et journal des synchronisations.
--
-- Ce fichier est idempotent : il peut être rejoué sans dommage.
-- ============================================================================

set search_path = papyrus, public;

-- ============================================================================
-- 1. Réglages par formulaire
-- ============================================================================

alter table papyrus.forms
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- Notifications email : destinataires, objets, corps des messages. Cette colonne
-- est délibérément absente de `public_forms` — un visiteur anonyme n'a aucune
-- raison de connaître qui est alerté à chaque réponse.
alter table papyrus.forms
  add column if not exists notification_settings jsonb not null default '{}'::jsonb;

-- ============================================================================
-- 2. Réponses partielles
-- ============================================================================

alter table papyrus.submissions
  add column if not exists is_partial boolean not null default false;

-- Identifiant de session généré par le navigateur du répondant. Sert uniquement
-- à retrouver sa propre ébauche : il n'identifie personne et n'est jamais croisé
-- avec autre chose.
alter table papyrus.submissions
  add column if not exists session_id text;

create unique index if not exists idx_submissions_session
  on papyrus.submissions(form_id, session_id) where session_id is not null;

create index if not exists idx_submissions_form_partial
  on papyrus.submissions(form_id, is_partial);

-- L'unicité par email ne doit porter que sur les réponses abouties : une ébauche
-- ne doit pas bloquer l'envoi définitif de la même personne.
drop index if exists papyrus.idx_submissions_email;
create index if not exists idx_submissions_email
  on papyrus.submissions(form_id, respondent_email)
  where respondent_email is not null and not is_partial;

-- ============================================================================
-- 3. Connexion Google (OAuth 2.0) par espace de travail
--
-- Seul le refresh token est conservé, chiffré applicativement (AES-256-GCM,
-- lib/crypto.ts). Les jetons d'accès, valables une heure, sont redemandés à
-- chaque besoin et ne touchent jamais la base.
-- ============================================================================

create table if not exists papyrus.google_credentials (
  team_id uuid primary key references papyrus.teams(id) on delete cascade,
  encrypted_refresh_token text not null,
  google_email text,
  scopes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 4. Intégrations par formulaire
-- ============================================================================

create table if not exists papyrus.form_integrations (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references papyrus.forms(id) on delete cascade,
  provider text not null check (provider in ('google_sheets')),
  -- Pour google_sheets : { spreadsheet_id, spreadsheet_name, sheet_title,
  --                        include_metadata, spreadsheet_url }
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Une seule intégration par fournisseur et par formulaire.
create unique index if not exists idx_form_integrations_unique
  on papyrus.form_integrations(form_id, provider);

-- Journal des synchronisations — l'équivalent de « event history log » côté Tally.
create table if not exists papyrus.integration_events (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references papyrus.form_integrations(id) on delete cascade,
  form_id uuid not null references papyrus.forms(id) on delete cascade,
  submission_id uuid references papyrus.submissions(id) on delete set null,
  status text not null check (status in ('success', 'error', 'skipped')),
  message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_integration_events_integration
  on papyrus.integration_events(integration_id, created_at desc);

drop trigger if exists trg_form_integrations_updated_at on papyrus.form_integrations;
create trigger trg_form_integrations_updated_at before update on papyrus.form_integrations
  for each row execute function papyrus.set_updated_at();

drop trigger if exists trg_google_credentials_updated_at on papyrus.google_credentials;
create trigger trg_google_credentials_updated_at before update on papyrus.google_credentials
  for each row execute function papyrus.set_updated_at();

-- ============================================================================
-- 5. Row Level Security
-- ============================================================================

alter table papyrus.google_credentials enable row level security;
alter table papyrus.form_integrations enable row level security;
alter table papyrus.integration_events enable row level security;

-- `google_credentials` n'a volontairement aucune policy, comme
-- `tally_credentials` : le jeton chiffré n'est atteignable que par le serveur,
-- via service_role.
revoke all on papyrus.google_credentials from anon, authenticated;

-- Une policy par commande — jamais `for all` : sur un `for all`, la clause USING
-- régirait aussi DELETE.
drop policy if exists form_integrations_select on papyrus.form_integrations;
create policy form_integrations_select on papyrus.form_integrations for select
  using (exists (
    select 1 from papyrus.forms f
    where f.id = form_integrations.form_id and papyrus.is_team_member(f.team_id)
  ));

drop policy if exists form_integrations_insert on papyrus.form_integrations;
create policy form_integrations_insert on papyrus.form_integrations for insert
  with check (exists (
    select 1 from papyrus.forms f
    where f.id = form_integrations.form_id and papyrus.is_team_member(f.team_id)
  ));

drop policy if exists form_integrations_update on papyrus.form_integrations;
create policy form_integrations_update on papyrus.form_integrations for update
  using (exists (
    select 1 from papyrus.forms f
    where f.id = form_integrations.form_id and papyrus.is_team_member(f.team_id)
  ))
  with check (exists (
    select 1 from papyrus.forms f
    where f.id = form_integrations.form_id and papyrus.is_team_member(f.team_id)
  ));

drop policy if exists form_integrations_delete on papyrus.form_integrations;
create policy form_integrations_delete on papyrus.form_integrations for delete
  using (exists (
    select 1 from papyrus.forms f
    where f.id = form_integrations.form_id and papyrus.is_team_member(f.team_id)
  ));

-- Le journal est en lecture seule côté client : il n'est écrit que par le
-- serveur, avec service_role, au moment d'une synchronisation.
drop policy if exists integration_events_select on papyrus.integration_events;
create policy integration_events_select on papyrus.integration_events for select
  using (exists (
    select 1 from papyrus.forms f
    where f.id = integration_events.form_id and papyrus.is_team_member(f.team_id)
  ));

-- ============================================================================
-- 6. Vues publiques
--
-- `public_forms` couvre désormais aussi les formulaires clos : sans cela, un
-- formulaire fermé renvoyait 404, alors que l'auteur peut vouloir afficher un
-- message d'explication (« Les inscriptions sont terminées »). Les champs, eux,
-- restent réservés aux formulaires réellement ouverts : `public_fields` n'est pas
-- modifiée, donc le contenu d'un formulaire clos n'est pas divulgué.
--
-- `settings` est exposée, `notification_settings` ne l'est pas.
-- ============================================================================

drop view if exists papyrus.public_forms cascade;
create view papyrus.public_forms as
  select
    f.id, f.team_id, f.title, f.slug, f.description, f.display_mode, f.status,
    f.theme, f.settings, f.access_type, f.languages, f.default_language,
    f.save_and_resume, f.unique_email, f.scoring_enabled, f.show_score_to_respondent,
    f.published_at, f.closes_at, f.created_at, f.updated_at,
    (f.access_password is not null and f.access_password <> '') as requires_password,
    -- Un formulaire est clos s'il a été archivé, si sa date limite est passée, ou
    -- si le quota de réponses fixé par son auteur est atteint.
    --
    -- Le quota est évalué dans un CASE et non dans une chaîne de AND : PostgreSQL
    -- ne garantit pas l'ordre d'évaluation des opérandes d'un AND, donc le cast
    -- `::bigint` pourrait s'exécuter avant le test de format et faire échouer la
    -- vue entière sur une valeur non numérique — c'est-à-dire mettre toutes les
    -- pages publiques en erreur à cause d'un seul formulaire mal renseigné.
    (
      f.status = 'closed'
      or (f.closes_at is not null and f.closes_at <= now())
      or case
           -- Comparaison textuelle plutôt que `::boolean` : dans une colonne
           -- jsonb, rien n'interdit une valeur inattendue, et un cast qui échoue
           -- casserait la vue pour tout le monde.
           when (f.settings ->> 'max_submissions_enabled') = 'true'
                and (f.settings ->> 'max_submissions') ~ '^[0-9]+$'
           then (
             select count(*) from papyrus.submissions s
             where s.form_id = f.id and not s.is_partial
           ) >= (f.settings ->> 'max_submissions')::bigint
           else false
         end
    ) as is_closed
  from papyrus.forms f
  where f.status in ('published', 'closed');

grant select on papyrus.public_forms to anon, authenticated;

-- `public_fields` et `public_logic_rules` sont recréées à l'identique : le
-- `cascade` ci-dessus ne les a pas touchées, mais la baseline les crée après
-- `public_forms` et un rejeu complet doit rester cohérent.
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

grant select on papyrus.public_fields to anon, authenticated;
grant select on papyrus.public_logic_rules to anon, authenticated;

-- ============================================================================
-- 7. Droits de table
-- ============================================================================

grant select, insert, update, delete on papyrus.form_integrations to authenticated;
grant select on papyrus.integration_events to authenticated;
grant all on papyrus.form_integrations to service_role;
grant all on papyrus.integration_events to service_role;
grant all on papyrus.google_credentials to service_role;
