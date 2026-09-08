-- ============================================================================
-- Papyrus — phase 5 : suivi des réponses
--
-- Une réponse n'est pas un fait figé : elle arrive, on la relit, on l'encaisse,
-- ou on l'annule. Sans statut, la seule façon de savoir où en est une
-- inscription est de tenir la liste ailleurs — dans un tableur, à la main, et
-- donc faux dès la deuxième personne qui y touche.
--
-- Quatre états, repris de mooove-invoice parce qu'ils correspondent à ce que
-- font réellement les équipes :
--
--   submitted  reçue, rien fait
--   reviewed   relue et validée
--   paid       encaissée
--   void       annulée — elle reste lisible, mais ne compte plus
--
-- Ce fichier est idempotent : il peut être rejoué sans dommage.
-- ============================================================================

set search_path = papyrus, public;

-- ============================================================================
-- 1. Colonnes
-- ============================================================================

alter table papyrus.submissions
  add column if not exists status text not null default 'submitted',
  add column if not exists status_updated_at timestamptz;

-- La contrainte est ajoutée à part : `add column` ne la poserait pas sur une
-- table déjà peuplée, et un `check` inline serait ignoré au rejeu.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'submissions_status_check'
  ) then
    alter table papyrus.submissions
      add constraint submissions_status_check
      check (status in ('submitted', 'reviewed', 'paid', 'void'));
  end if;
end $$;

-- Filtrer par statut est le geste le plus fréquent de l'onglet Réponses.
create index if not exists submissions_form_status_idx
  on papyrus.submissions (form_id, status);

-- ============================================================================
-- 2. Une réponse annulée ne consomme plus de place
--
-- C'est la décision qui fait le plus de différence dans cette migration, et la
-- plus facile à oublier : `registered_count` et le quota `max_submissions`
-- comptaient toutes les réponses non partielles. Une inscription annulée
-- continuait donc de faire monter le tarif dégressif et de rapprocher le
-- formulaire de sa fermeture — autrement dit, annuler une inscription ne
-- libérait pas la place qu'elle occupait, et personne ne pouvait le voir depuis
-- l'interface.
--
-- Les deux comptes excluent désormais `void`. Ils restent alignés l'un sur
-- l'autre : un formulaire qui annonce « il reste N places » et un formulaire qui
-- se ferme à N réponses doivent compter la même chose.
--
-- Même piège qu'aux migrations 004 à 007 : PostgreSQL fige la liste des colonnes
-- d'un `select *` à la création d'une vue, et `public_forms` est écrite colonne
-- par colonne. Elle est donc recréée en entier.
-- ============================================================================

drop view if exists papyrus.public_forms cascade;
create view papyrus.public_forms as
  select
    f.id,
    f.team_id,
    f.title,
    f.slug,
    f.description,
    f.display_mode,
    f.status,
    f.theme,
    f.settings,
    f.access_type,
    f.languages,
    f.default_language,
    f.save_and_resume,
    f.unique_email,
    f.scoring_enabled,
    f.show_score_to_respondent,
    f.published_at,
    f.closes_at,
    f.created_at,
    f.updated_at,
    f.pricing_config,
    f.confirmation_config,
    coalesce(p.pricing, '{}'::jsonb) as project_pricing,
    case
      when (f.pricing_config -> 'tiered' ->> 'enabled') = 'true' then (
        select count(*)
        from papyrus.submissions s
        where s.form_id = f.id and not s.is_partial and s.status <> 'void'
      )
      else null
    end as registered_count,
    f.access_password is not null and f.access_password <> '' as requires_password,
    f.status = 'closed'
      or (f.closes_at is not null and f.closes_at <= now())
      or case
        when (f.settings ->> 'max_submissions_enabled') = 'true'
          and (f.settings ->> 'max_submissions') ~ '^[0-9]+$'
        then (
          select count(*)
          from papyrus.submissions s
          where s.form_id = f.id and not s.is_partial and s.status <> 'void'
        ) >= ((f.settings ->> 'max_submissions')::bigint)
        else false
      end as is_closed
  from papyrus.forms f
  left join papyrus.projects p on p.id = f.project_id
  where f.status = any (array['published', 'closed']);

grant select on papyrus.public_forms to anon, authenticated;

notify pgrst, 'reload schema';
