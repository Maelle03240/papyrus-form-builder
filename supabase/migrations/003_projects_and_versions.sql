-- ============================================================================
-- Papyrus — couche Projet et historique de versions
--
-- Deux ajouts, tous idempotents :
--
--  1. `projects` — la couche qui manquait. Jusqu'ici la hiérarchie était
--     « espace de travail → formulaire », l'espace de travail étant la table
--     `teams` (l'interface dit « espace de travail », la base dit « team » :
--     c'est la même chose). Un projet regroupe plusieurs formulaires et porte ce
--     qui leur est commun : la marque, les langues, et les modules activés.
--
--     Règle de répartition, valable pour toutes les phases à venir : une
--     configuration qui référence des champs appartient au formulaire ; tout le
--     reste appartient au projet. La tarification et les règles d'e-mail
--     resteront donc sur le formulaire, les partenaires et la numérotation des
--     factures iront sur le projet.
--
--  2. `form_versions` — instantanés restaurables du contenu d'un formulaire.
--     Ils arrivent avant l'IA, et pas après, parce qu'une construction pilotée
--     par IA qu'on ne peut pas annuler n'est pas utilisable : chaque lot d'appels
--     d'outils sera encapsulé dans un instantané.
--
-- Ce fichier est idempotent : il peut être rejoué sans dommage.
-- ============================================================================

set search_path = papyrus, public;

-- ============================================================================
-- 1. Projets
-- ============================================================================

create table if not exists papyrus.projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references papyrus.teams(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  name text not null default 'Nouveau projet',
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),

  -- Valeurs par défaut héritées par les formulaires du projet. Un formulaire
  -- peut les surcharger : c'est le projet qui donne le ton, pas qui impose.
  languages text[] not null default array['fr'],
  default_language text not null default 'fr',
  theme jsonb not null default '{}'::jsonb,

  -- Modules activés. Ils commandent l'affichage des onglets (Tarification,
  -- Partenaires…) : un projet d'enquête n'a aucune raison de montrer un onglet
  -- de facturation. L'assistant de création les renseigne d'après les réponses
  -- au questionnaire ; ils restent modifiables ensuite.
  modules jsonb not null default
    '{"pricing":false,"partners":false,"invoicing":false,"email":false}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_team on papyrus.projects(team_id);
create index if not exists idx_projects_status on papyrus.projects(team_id, status);

alter table papyrus.projects enable row level security;

-- Une policy par commande, jamais `for all` : sur un `for all`, la clause USING
-- régit aussi le DELETE, et une erreur d'écriture y devient une suppression
-- autorisée.
drop policy if exists projects_select on papyrus.projects;
create policy projects_select on papyrus.projects for select
  using (papyrus.is_team_member(team_id));

drop policy if exists projects_insert on papyrus.projects;
create policy projects_insert on papyrus.projects for insert
  with check (papyrus.is_team_member(team_id));

drop policy if exists projects_update on papyrus.projects;
create policy projects_update on papyrus.projects for update
  using (papyrus.is_team_member(team_id))
  with check (papyrus.is_team_member(team_id));

drop policy if exists projects_delete on papyrus.projects;
create policy projects_delete on papyrus.projects for delete
  using (papyrus.is_team_member(team_id));

drop trigger if exists trg_projects_updated_at on papyrus.projects;
create trigger trg_projects_updated_at before update on papyrus.projects
  for each row execute function papyrus.set_updated_at();

-- ============================================================================
-- 2. Rattachement des formulaires
-- ============================================================================

alter table papyrus.forms
  add column if not exists project_id uuid references papyrus.projects(id) on delete cascade;

create index if not exists idx_forms_project on papyrus.forms(project_id);

-- Reprise des formulaires existants : un projet par espace de travail, qui
-- récupère tout ce que l'espace contenait déjà. Les modèles (`is_template`) en
-- sont exclus — un modèle n'appartient à aucun projet, il sert à en créer.
do $$
declare
  membership record;
  created_project_id uuid;
begin
  for membership in
    select distinct team_id
    from papyrus.forms
    where project_id is null and is_template = false
  loop
    insert into papyrus.projects (team_id, name, description)
    values (
      membership.team_id,
      'Mes formulaires',
      'Projet créé automatiquement lors de l''introduction de la couche Projet.'
    )
    returning id into created_project_id;

    update papyrus.forms
      set project_id = created_project_id
      where team_id = membership.team_id
        and project_id is null
        and is_template = false;
  end loop;
end $$;

-- Tout formulaire réel appartient à un projet. Les modèles sont la seule
-- exception : ils vivent hors de toute arborescence de projet, et le bouton
-- « Convertir en modèle » bascule le drapeau sur la ligne existante sans la
-- déplacer — d'où une contrainte permissive dans ce sens précis.
alter table papyrus.forms drop constraint if exists forms_project_required;
alter table papyrus.forms add constraint forms_project_required
  check (is_template or project_id is not null);

-- ============================================================================
-- 3. Historique de versions
-- ============================================================================

create table if not exists papyrus.form_versions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references papyrus.forms(id) on delete cascade,

  -- Contenu complet du formulaire au moment de l'instantané : métadonnées,
  -- champs et règles logiques. Un instantané doit rester lisible même si le
  -- modèle de données évolue — d'où un jsonb figé plutôt que des clés étrangères
  -- vers des lignes qui n'existeront peut-être plus.
  snapshot jsonb not null,

  label text not null default '',
  -- `ai` est distingué de `manual` pour que « annuler ce que l'IA vient de
  -- faire » soit une action évidente, et pas une fouille dans l'historique.
  kind text not null default 'auto' check (kind in ('auto', 'manual', 'ai')),

  created_by uuid references auth.users(id) on delete set null,
  -- Dénormalisé : l'historique doit rester lisible après le départ d'un membre.
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_form_versions_form
  on papyrus.form_versions(form_id, created_at desc);

alter table papyrus.form_versions enable row level security;

drop policy if exists form_versions_select on papyrus.form_versions;
create policy form_versions_select on papyrus.form_versions for select
  using (exists (
    select 1 from papyrus.forms f
    where f.id = form_versions.form_id and papyrus.is_team_member(f.team_id)
  ));

drop policy if exists form_versions_insert on papyrus.form_versions;
create policy form_versions_insert on papyrus.form_versions for insert
  with check (exists (
    select 1 from papyrus.forms f
    where f.id = form_versions.form_id and papyrus.is_team_member(f.team_id)
  ));

-- Un instantané ne se modifie pas : le corriger reviendrait à réécrire
-- l'histoire, ce qui est exactement ce qu'un historique doit empêcher. Pas de
-- policy `update` — donc aucune mise à jour n'est possible.

drop policy if exists form_versions_delete on papyrus.form_versions;
create policy form_versions_delete on papyrus.form_versions for delete
  using (exists (
    select 1 from papyrus.forms f
    where f.id = form_versions.form_id and papyrus.is_team_member(f.team_id)
  ));

-- ============================================================================
-- 4. Droits de table
-- ============================================================================

grant select, insert, update, delete on papyrus.projects to authenticated;
grant select, insert, delete on papyrus.form_versions to authenticated;
grant all on papyrus.projects to service_role;
grant all on papyrus.form_versions to service_role;
