-- ============================================================================
-- Papyrus — phase 4 : e-mails de confirmation et facturation
--
-- Trois choses arrivent après l'envoi d'un formulaire, et elles n'ont jamais eu
-- de place en base :
--
--   1. un numéro de bon de commande, tiré d'une séquence propre au projet ;
--   2. un e-mail au répondant, choisi parmi plusieurs messages selon ses
--      réponses, avec le PDF en pièce jointe ;
--   3. l'écran de remerciement, qui doit pouvoir dire autre chose que « Merci ! ».
--
-- Répartition, toujours la même règle : une configuration qui référence des
-- champs appartient au formulaire. Les règles d'e-mail citent des questions
-- (« si la formule choisie est Table de 6, envoyer ce message ») : elles vivent
-- donc sur le formulaire. La numérotation ne cite rien : une séquence par
-- événement, donc sur le projet.
--
-- Ce fichier est idempotent : il peut être rejoué sans dommage.
-- ============================================================================

set search_path = papyrus, public;

-- ============================================================================
-- 1. Numérotation, portée par le projet
-- ============================================================================

-- Colonnes réelles et non un jsonb : `invoice_next` est incrémenté sous verrou
-- de ligne par `assign_invoice_number` ci-dessous. Un compteur enfoui dans un
-- jsonb ne s'incrémente pas atomiquement — il se lit, se modifie et se réécrit,
-- et deux envois simultanés repartiraient du même numéro.
alter table papyrus.projects
  add column if not exists invoice_prefix text not null default 'CMD',
  add column if not exists invoice_next   bigint not null default 1,
  add column if not exists invoice_pad    smallint not null default 4;

-- ============================================================================
-- 2. Colonnes du formulaire et de la réponse
-- ============================================================================

-- Message par défaut, règles conditionnelles, copies, pièce jointe.
-- JAMAIS exposé publiquement : il contient des adresses en copie cachée et le
-- corps des messages envoyés (cf. la vue plus bas).
alter table papyrus.forms
  add column if not exists email_config jsonb not null default '{}'::jsonb;

-- Écran de remerciement : titre, message, mention du numéro, bouton de retour.
-- Celui-ci EST public — c'est ce que le répondant voit.
alter table papyrus.forms
  add column if not exists confirmation_config jsonb not null default '{}'::jsonb;

-- Numéro attribué à l'envoi. Nul tant que le module facturation du projet est
-- éteint : un sondage n'a pas de bon de commande.
alter table papyrus.submissions
  add column if not exists invoice_number text;

-- Suivi de l'e-mail de confirmation. « Le client a-t-il reçu son bon de
-- commande ? » est la première question posée quand quelque chose cloche, et
-- sans ces deux colonnes la seule réponse possible est « il faudrait regarder
-- les journaux du serveur ».
alter table papyrus.submissions
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_error   text;

-- Recherche par numéro depuis l'onglet Réponses.
--
-- Index non unique, délibérément : la séquence est propre à un projet, et deux
-- projets peuvent légitimement partager un préfixe. Une contrainte d'unicité
-- globale refuserait alors un envoi parfaitement valide, au pire moment — au
-- milieu d'une inscription. L'unicité à l'intérieur d'un projet est garantie
-- par la séquence elle-même, pas par un index.
create index if not exists submissions_invoice_number_idx
  on papyrus.submissions (invoice_number)
  where invoice_number is not null;

-- ============================================================================
-- 3. Attribution du numéro — sans course critique
--
-- Trois propriétés, et chacune répond à une manière précise de se tromper :
--
--   · Atomique. L'incrément et sa lecture sont un seul `update ... returning`,
--     donc sous verrou de ligne. Lire puis écrire donnerait le même numéro à
--     deux inscriptions simultanées.
--
--   · Après l'insertion, jamais avant. mooove-invoice tire le numéro d'abord :
--     si l'enregistrement échoue ensuite, le numéro est brûlé et la séquence
--     garde un trou définitif. Ici la réponse existe déjà quand le numéro est
--     attribué — un échec ne coûte rien.
--
--   · Rejouable, et verrouillée pour l'être vraiment. Une réponse qui porte
--     déjà un numéro le conserve. Sans le `for update`, deux appels simultanés
--     sur la MÊME réponse — un double-clic, une requête rejouée par le réseau —
--     lisent tous deux « pas de numéro », en tirent chacun un, et un seul des
--     deux s'écrit : le second est perdu, et la séquence garde un trou. C'est
--     exactement ce qu'un test de concurrence a montré, avec six numéros brûlés
--     sur seize. Le verrou fait attendre le second appel, qui trouve alors le
--     numéro déjà attribué et le renvoie sans rien consommer.
--
-- `security definer` avec un `search_path` figé : la fonction n'est accordée
-- qu'à `service_role`, le rôle de la route d'envoi. Ouverte à `anon`, elle
-- laisserait n'importe qui vider la séquence d'un projet en la martelant.
-- ============================================================================

create or replace function papyrus.assign_invoice_number(
  p_submission uuid,
  p_project    uuid
) returns text
language plpgsql
security definer
set search_path = papyrus, public
as $$
declare
  v_existing text;
  v_prefix   text;
  v_seq      bigint;
  v_pad      smallint;
begin
  select invoice_number into v_existing
    from papyrus.submissions
   where id = p_submission
     for update;

  -- Réponse inexistante : ne rien consommer. Sans cette garde, un identifiant
  -- erroné ferait avancer le compteur du projet sans que rien ne porte le
  -- numéro tiré.
  if not found then
    return null;
  end if;

  if v_existing is not null and v_existing <> '' then
    return v_existing;
  end if;

  update papyrus.projects
     set invoice_next = invoice_next + 1
   where id = p_project
  returning invoice_prefix, invoice_next - 1, invoice_pad
      into v_prefix, v_seq, v_pad;

  if not found then
    return null;
  end if;

  v_existing := coalesce(nullif(btrim(v_prefix), ''), 'CMD')
                || '-'
                || lpad(v_seq::text, greatest(coalesce(v_pad, 4), 1), '0');

  update papyrus.submissions
     set invoice_number = v_existing
   where id = p_submission;

  return v_existing;
end;
$$;

revoke all on function papyrus.assign_invoice_number(uuid, uuid) from public;
grant execute on function papyrus.assign_invoice_number(uuid, uuid) to service_role;

-- ============================================================================
-- 4. Vues publiques
--
-- Le piège des migrations 004, 005 et 006, une quatrième fois : PostgreSQL fige
-- la liste des colonnes d'un `select *` à la création d'une vue. `public_forms`
-- est réécrite colonne par colonne, donc il faut l'y ajouter à la main.
--
-- Et surtout : `confirmation_config` entre dans la vue, `email_config` n'y
-- entre PAS. La première est ce que le répondant lit à l'écran ; la seconde
-- porte les adresses en copie cachée et le corps des messages. Les publier
-- reviendrait à laisser lire, depuis un onglet anonyme, à qui l'inscription
-- d'un client est signalée.
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

-- PostgREST garde en mémoire le schéma qu'il a lu au démarrage : sans cette
-- notification, les nouvelles colonnes restent invisibles à l'API.
notify pgrst, 'reload schema';
