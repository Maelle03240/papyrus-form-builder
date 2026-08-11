-- ============================================================================
-- Papyrus — Migration 014 : Aligner le schéma sur ce que l'application écrit
--
-- Plusieurs propriétés existaient dans les types TypeScript et dans le builder
-- sans colonne correspondante en base. Tant que l'application tournait en mode
-- local (localStorage), personne ne s'en apercevait ; dès le passage à Supabase,
-- chaque sauvegarde concernée échoue.
--
-- Corrections :
--   · `fields.rows`          — lignes d'une question matricielle (le builder les
--                              édite, elles n'étaient stockées nulle part) ;
--   · `fields.style`         — style par champ (police, taille, couleur, icône) ;
--   · `fields.layout_width`  — champ pleine largeur ou demi-largeur ;
--   · `fields.subfields`     — sous-questions d'un choix multiple ;
--   · `forms.display_mode`   — la contrainte CHECK n'autorisait que 'scroll' et
--                              'typeform', alors que le mode 'sections' est le
--                              défaut proposé dans l'interface ;
--   · `forms.scope`          — valeurs alignées sur le type FormScope ;
--   · `forms.workspace_id`   — retiré du modèle : l'espace de travail EST
--                              `team_id`, entretenir deux notions créait des
--                              formulaires rattachés à un espace fantôme.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. FIELDS — colonnes manquantes
-- ----------------------------------------------------------------------------

alter table fields
  add column if not exists rows jsonb default '[]'::jsonb,
  add column if not exists style jsonb default '{}'::jsonb,
  add column if not exists subfields jsonb default '[]'::jsonb,
  add column if not exists layout_width text
    check (layout_width in ('full', 'half')) default 'full';

comment on column fields.rows is
  'Lignes d''une question matricielle. Les colonnes sont stockées dans `options`.';
comment on column fields.subfields is
  'Sous-questions appliquées à chaque option cochée d''un choix multiple.';

-- ----------------------------------------------------------------------------
-- 2. FORMS — contraintes alignées sur l'interface
-- ----------------------------------------------------------------------------

-- Le mode « sections » est proposé dans le builder et sélectionné par défaut à
-- l'import Tally : sans cette correction, l'enregistrement était rejeté.
alter table forms drop constraint if exists forms_display_mode_check;
alter table forms add constraint forms_display_mode_check
  check (display_mode in ('scroll', 'sections', 'typeform'));

-- `scope` valait 'private' par défaut, une valeur qui n'existe pas dans le type
-- FormScope ('personal' | 'workspace' | 'global').
update forms set scope = 'personal' where scope is null or scope = 'private';

alter table forms drop constraint if exists forms_scope_check;
alter table forms add constraint forms_scope_check
  check (scope is null or scope in ('personal', 'workspace', 'global'));

alter table forms alter column scope set default 'personal';

-- ----------------------------------------------------------------------------
-- 3. Intégrité — un formulaire doit toujours appartenir à une équipe
--
-- `team_id` était nullable et sans contrainte : un formulaire orphelin devenait
-- invisible pour tout le monde, y compris son créateur, et échappait à la RLS.
-- ----------------------------------------------------------------------------

delete from forms where team_id is null;
alter table forms alter column team_id set not null;

create index if not exists idx_forms_slug on forms(slug);
create index if not exists idx_forms_status_team on forms(status, team_id);
create index if not exists idx_submissions_form on submissions(form_id);

-- ----------------------------------------------------------------------------
-- 4. Nettoyage : les modèles Mooove « globaux » doivent rester lisibles par tous
-- ----------------------------------------------------------------------------

drop policy if exists "anyone reads global templates" on forms;
create policy "anyone reads global templates" on forms for select
  to authenticated
  using (is_template = true and scope = 'global');
