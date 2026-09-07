-- ============================================================================
-- Papyrus — les sections deviennent des objets, et non plus un type de champ
--
-- Jusqu'ici une section était un pseudo-champ `section_break` planté dans la
-- liste plate : le rendu découpait les pages en cherchant ces marqueurs. Le
-- procédé tenait tant qu'une section n'était qu'un titre. Il ne tient plus dès
-- qu'elle doit porter ses propres conditions d'affichage (phase 2), être
-- déplacée d'un bloc, ou être créée par un appel d'outil de l'IA (phase 7) :
-- toutes choses qu'on ne sait pas faire à un séparateur.
--
-- Après cette migration, tout champ appartient à exactement une section, et tout
-- formulaire possède au moins une section.
--
-- Les modèles du catalogue, eux, gardent `section_break` comme convention
-- d'écriture : `lib/templates/types.ts` décrit un format de fichier de contenu,
-- pas le modèle de données, et `lib/templates/to-form.ts` fait la conversion à
-- l'import. Les 51 fichiers JSON n'ont donc pas à être réécrits.
--
-- Ce fichier est idempotent : il peut être rejoué sans dommage.
-- ============================================================================

set search_path = papyrus, public;

-- ============================================================================
-- 1. Sections
-- ============================================================================

create table if not exists papyrus.sections (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references papyrus.forms(id) on delete cascade,

  -- Même forme multilingue que les libellés de champ : `{"fr": "...", "en": "..."}`.
  -- Un titre vide est légitime — c'est le cas de la section d'ouverture d'un
  -- formulaire qui commence directement par ses questions.
  title jsonb not null default '{}'::jsonb,
  description jsonb not null default '{}'::jsonb,

  section_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_sections_form on papyrus.sections(form_id, section_order);

alter table papyrus.sections enable row level security;

drop policy if exists sections_select on papyrus.sections;
create policy sections_select on papyrus.sections for select
  using (exists (
    select 1 from papyrus.forms f
    where f.id = sections.form_id and papyrus.is_team_member(f.team_id)
  ));

drop policy if exists sections_insert on papyrus.sections;
create policy sections_insert on papyrus.sections for insert
  with check (exists (
    select 1 from papyrus.forms f
    where f.id = sections.form_id and papyrus.is_team_member(f.team_id)
  ));

drop policy if exists sections_update on papyrus.sections;
create policy sections_update on papyrus.sections for update
  using (exists (
    select 1 from papyrus.forms f
    where f.id = sections.form_id and papyrus.is_team_member(f.team_id)
  ))
  with check (exists (
    select 1 from papyrus.forms f
    where f.id = sections.form_id and papyrus.is_team_member(f.team_id)
  ));

drop policy if exists sections_delete on papyrus.sections;
create policy sections_delete on papyrus.sections for delete
  using (exists (
    select 1 from papyrus.forms f
    where f.id = sections.form_id and papyrus.is_team_member(f.team_id)
  ));

-- ============================================================================
-- 2. Rattachement des champs, et cible de saut vers une section
-- ============================================================================

alter table papyrus.fields
  add column if not exists section_id uuid references papyrus.sections(id) on delete cascade;

create index if not exists idx_fields_section on papyrus.fields(section_id, field_order);

-- « Aller à » pouvait viser une rupture, c'est-à-dire une section. Maintenant
-- que les sections ne sont plus des champs, la cible ne peut plus vivre dans
-- `target_field_id` : il porte une clé étrangère vers `fields`.
alter table papyrus.logic_rules
  add column if not exists target_section_id uuid references papyrus.sections(id) on delete cascade;

-- ============================================================================
-- 3. Reprise des données
--
-- Pour chaque formulaire, on parcourt les champs dans l'ordre : chaque rupture
-- ouvre une section qui hérite de son libellé et de sa description, et les
-- champs qui suivent lui sont rattachés. Les champs situés avant toute rupture
-- forment une section d'ouverture sans titre.
--
-- L'ordre des champs est renuméroté à l'intérieur de chaque section : il devient
-- relatif à celle-ci, et non plus au formulaire entier.
-- ============================================================================

do $$
declare
  target_form record;
  field_row record;
  current_section uuid;
  section_seq int;
  next_field_order int;
begin
  for target_form in select id from papyrus.forms loop
    -- Un formulaire déjà repris est laissé tel quel : la migration se rejoue
    -- sans dupliquer les sections.
    if exists (select 1 from papyrus.sections where form_id = target_form.id) then
      continue;
    end if;

    current_section := null;
    section_seq := 0;
    next_field_order := 0;

    for field_row in
      select id, type, label, description, field_order
      from papyrus.fields
      where form_id = target_form.id
      order by field_order, created_at
    loop
      if field_row.type = 'section_break' then
        insert into papyrus.sections (form_id, title, description, section_order)
        values (target_form.id, field_row.label, field_row.description, section_seq)
        returning id into current_section;

        -- Une règle « aller à » qui visait cette rupture vise désormais la
        -- section. Le remappage se fait ici, tant que le lien existe encore :
        -- `target_field_id` est en `on delete cascade`, donc supprimer la
        -- rupture plus bas emporterait la règle sans un mot.
        update papyrus.logic_rules
          set target_section_id = current_section,
              target_field_id = null
          where target_field_id = field_row.id;

        section_seq := section_seq + 1;
        next_field_order := 0;
      else
        if current_section is null then
          insert into papyrus.sections (form_id, title, description, section_order)
          values (target_form.id, '{}'::jsonb, '{}'::jsonb, section_seq)
          returning id into current_section;
          section_seq := section_seq + 1;
          next_field_order := 0;
        end if;

        update papyrus.fields
          set section_id = current_section,
              field_order = next_field_order
          where id = field_row.id;

        next_field_order := next_field_order + 1;
      end if;
    end loop;

    -- Un formulaire vide, ou qui ne contenait que des ruptures, doit tout de
    -- même avoir une section : c'est là que le constructeur déposera sa première
    -- question, et `section_id` est sur le point de devenir obligatoire.
    if not exists (select 1 from papyrus.sections where form_id = target_form.id) then
      insert into papyrus.sections (form_id, section_order)
      values (target_form.id, 0);
    end if;
  end loop;
end $$;

-- Les ruptures ont livré leur contenu aux sections : elles n'ont plus d'objet.
delete from papyrus.fields where type = 'section_break';

-- ============================================================================
-- 4. Verrouillage du nouvel invariant
-- ============================================================================

-- Tout champ appartient à une section. La contrainte est posée après la reprise,
-- donc elle est validée sur les données existantes et non simplement déclarée.
alter table papyrus.fields alter column section_id set not null;

alter table papyrus.fields drop constraint if exists fields_type_check;
alter table papyrus.fields add constraint fields_type_check check (type in (
  'short_text', 'long_text', 'email', 'phone', 'number', 'url',
  'single_choice', 'multiple_choice', 'dropdown', 'rating', 'nps',
  'date', 'file', 'statement', 'image', 'video', 'matrix'
));

-- ============================================================================
-- 5. Vue publique
--
-- Mêmes conditions que `public_fields` : un formulaire non publié ou clos ne
-- divulgue ni ses questions ni la structure qui les porte.
-- ============================================================================

drop view if exists papyrus.public_sections cascade;
create view papyrus.public_sections as
  select s.*
  from papyrus.sections s
  join papyrus.forms fo on fo.id = s.form_id
  where fo.status = 'published' and (fo.closes_at is null or fo.closes_at > now());

grant select on papyrus.public_sections to anon, authenticated;

-- `public_fields` et `public_logic_rules` doivent être recréées, et pas
-- seulement laissées en place : PostgreSQL développe le `select *` au moment de
-- la création de la vue et fige la liste des colonnes. Les vues existantes
-- n'exposeraient donc jamais `section_id` ni `target_section_id`, et le rendu
-- public recevrait des champs sans section — c'est-à-dire un formulaire vide,
-- sans la moindre erreur pour le signaler.

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

grant select, insert, update, delete on papyrus.sections to authenticated;
grant all on papyrus.sections to service_role;
