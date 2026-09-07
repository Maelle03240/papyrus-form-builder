-- ============================================================================
-- Papyrus — phase 3 : tarification
--
-- Prix par option, compteurs de quantité, TVA, codes de réduction et tarifs
-- dégressifs. Le total se calcule en direct sur le formulaire public et se fige
-- au moment de l'envoi.
--
-- Répartition, la même règle que partout : une configuration qui référence des
-- champs appartient au formulaire ; tout le reste appartient au projet. La
-- devise et la TVA vivent donc sur le projet — un même événement facture dans
-- une seule monnaie —, et les prix, remises et paliers sur le formulaire, parce
-- qu'ils désignent ses options.
--
-- Les prix des options ne prennent PAS de colonne : ils vivent dans la colonne
-- `fields.options` existante, sur l'option elle-même. C'est l'option qui est
-- vendue — la renommer, la déplacer ou la dupliquer doit emporter son prix.
--
-- Ce fichier est idempotent : il peut être rejoué sans dommage.
-- ============================================================================

set search_path = papyrus, public;

-- ============================================================================
-- 1. Colonnes
-- ============================================================================

-- Devise et TVA du projet : `{"currency":"MUR","currency_position":"before",
-- "vat_enabled":false,"vat_rate":15}`.
alter table papyrus.projects
  add column if not exists pricing jsonb not null default '{}'::jsonb;

-- Tarification du formulaire : activation, libellés, remises, paliers, et les
-- surcharges éventuelles de la devise ou de la TVA du projet.
alter table papyrus.forms
  add column if not exists pricing_config jsonb not null default '{}'::jsonb;

-- `count_in_total` et les compteurs de quantité. Nullable : la quasi-totalité
-- des champs n'a rien à voir avec un prix, et un objet vide y serait pris pour
-- une configuration.
alter table papyrus.fields
  add column if not exists pricing jsonb;

-- Totaux figés à l'envoi. Ils ne sont jamais recalculés : c'est ce qui permet de
-- rééditer une facture six mois plus tard, avec des prix modifiés entre-temps.
alter table papyrus.submissions
  add column if not exists pricing jsonb;

-- ============================================================================
-- 2. Vues publiques
--
-- Même piège qu'aux migrations 004 et 005 : PostgreSQL fige la liste des
-- colonnes d'une vue à sa création. Sans recréation, `public_fields` n'exposerait
-- pas `pricing` et `public_forms` ni `pricing_config` ni les réglages du projet
-- — le formulaire public afficherait un total de zéro sur un formulaire payant,
-- sans la moindre erreur pour le signaler.
-- ============================================================================

drop view if exists papyrus.public_fields cascade;
create view papyrus.public_fields as
  select f.*
  from papyrus.fields f
  join papyrus.forms fo on fo.id = f.form_id
  where fo.status = 'published' and (fo.closes_at is null or fo.closes_at > now());

grant select on papyrus.public_fields to anon, authenticated;

-- `public_forms` gagne trois colonnes.
--
-- `project_pricing` expose la devise et la TVA du projet, et rien d'autre : la
-- résolution « le formulaire surcharge le projet » a lieu dans `lib/pricing.ts`,
-- une seule fois, pour le navigateur comme pour le serveur. La refaire en SQL
-- ferait vivre deux règles là où il n'en faut qu'une.
--
-- `registered_count` est le nombre de réponses déjà enregistrées. Il n'est
-- exposé QUE si le formulaire applique un tarif dégressif : un tarif early bird
-- annonce de lui-même « il reste N places », alors que le compte des réponses
-- d'un sondage ne regarde personne. Hors de ce cas, la colonne vaut NULL.
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
    coalesce(p.pricing, '{}'::jsonb) as project_pricing,
    case
      when (f.pricing_config -> 'tiered' ->> 'enabled') = 'true' then (
        select count(*)
        from papyrus.submissions s
        where s.form_id = f.id and not s.is_partial
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
          where s.form_id = f.id and not s.is_partial
        ) >= ((f.settings ->> 'max_submissions')::bigint)
        else false
      end as is_closed
  from papyrus.forms f
  left join papyrus.projects p on p.id = f.project_id
  where f.status = any (array['published', 'closed']);

grant select on papyrus.public_forms to anon, authenticated;
