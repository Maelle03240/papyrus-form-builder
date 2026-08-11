-- ============================================================================
-- Papyrus — Migration 012 : Durcissement sécurité (RLS)
--
-- Corrige quatre failles présentes depuis la migration 001 :
--
--  1. `forms` était lisible en entier par n'importe qui dès qu'un formulaire
--     était publié — y compris la colonne `access_password` en clair.
--  2. Les policies `for all` sur `fields` et `logic_rules` utilisaient
--     `status = 'published'` dans leur clause USING. En PostgreSQL, USING régit
--     aussi DELETE et UPDATE : n'importe quel visiteur anonyme pouvait donc
--     SUPPRIMER ou MODIFIER les champs de tout formulaire publié.
--  3. `profiles` exposait l'email de tous les utilisateurs à tout compte
--     authentifié (énumération d'annuaire).
--  4. `submissions` n'était protégée d'aucune limite : la même policy INSERT
--     autorisait un nombre illimité d'écritures anonymes.
--
-- Principe appliqué : la lecture publique passe désormais par des VUES
-- restreintes en colonnes, et les policies de mutation sont séparées par
-- commande (SELECT / INSERT / UPDATE / DELETE) au lieu d'un `for all` fourre-tout.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Helper : l'utilisateur courant est-il admin de cette équipe ?
--    `security definer` pour éviter la récursion infinie de RLS sur team_members.
-- ----------------------------------------------------------------------------

create or replace function is_team_admin(check_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from team_members
    where user_id = auth.uid()
      and team_id = check_team_id
      and role = 'admin'
  );
$$;

-- ----------------------------------------------------------------------------
-- 1. FORMS — séparer lecture publique et écriture équipe
-- ----------------------------------------------------------------------------

-- Les policies trop larges de 001 et de sql-policies-check.sql.
drop policy if exists "anyone can read published forms" on forms;
drop policy if exists "Public can read published forms" on forms;
drop policy if exists "team members write forms" on forms;

-- Les membres de l'équipe gardent un accès complet à leurs formulaires.
drop policy if exists "team members read forms" on forms;
create policy "team members read forms" on forms for select
  using (is_team_member(team_id));

create policy "team members insert forms" on forms for insert
  with check (is_team_member(team_id));

create policy "team members update forms" on forms for update
  using (is_team_member(team_id))
  with check (is_team_member(team_id));

create policy "team members delete forms" on forms for delete
  using (is_team_member(team_id));

-- Lecture anonyme : uniquement via la vue `public_forms` ci-dessous, qui
-- n'expose pas `access_password`. La table elle-même n'est plus lisible par anon.

-- ----------------------------------------------------------------------------
-- 2. FIELDS — USING séparé par commande
-- ----------------------------------------------------------------------------

drop policy if exists "fields follow form access" on fields;
drop policy if exists "Public can read fields of published forms" on fields;

create policy "team members read fields" on fields for select
  using (
    exists (select 1 from forms f where f.id = fields.form_id and is_team_member(f.team_id))
  );

create policy "team members insert fields" on fields for insert
  with check (
    exists (select 1 from forms f where f.id = fields.form_id and is_team_member(f.team_id))
  );

create policy "team members update fields" on fields for update
  using (
    exists (select 1 from forms f where f.id = fields.form_id and is_team_member(f.team_id))
  )
  with check (
    exists (select 1 from forms f where f.id = fields.form_id and is_team_member(f.team_id))
  );

create policy "team members delete fields" on fields for delete
  using (
    exists (select 1 from forms f where f.id = fields.form_id and is_team_member(f.team_id))
  );

-- ----------------------------------------------------------------------------
-- 3. LOGIC RULES — même correction
-- ----------------------------------------------------------------------------

drop policy if exists "logic follows form access" on logic_rules;

create policy "team members read logic" on logic_rules for select
  using (
    exists (select 1 from forms f where f.id = logic_rules.form_id and is_team_member(f.team_id))
  );

create policy "team members insert logic" on logic_rules for insert
  with check (
    exists (select 1 from forms f where f.id = logic_rules.form_id and is_team_member(f.team_id))
  );

create policy "team members update logic" on logic_rules for update
  using (
    exists (select 1 from forms f where f.id = logic_rules.form_id and is_team_member(f.team_id))
  )
  with check (
    exists (select 1 from forms f where f.id = logic_rules.form_id and is_team_member(f.team_id))
  );

create policy "team members delete logic" on logic_rules for delete
  using (
    exists (select 1 from forms f where f.id = logic_rules.form_id and is_team_member(f.team_id))
  );

-- ----------------------------------------------------------------------------
-- 4. Vues publiques — lecture anonyme sans fuite de colonnes
--
-- `security_invoker = off` (défaut) : la vue s'exécute avec les droits de son
-- propriétaire, ce qui contourne volontairement la RLS des tables sous-jacentes.
-- C'est sûr ici parce que la vue filtre elle-même sur `status = 'published'`
-- et ne sélectionne aucune colonne sensible.
-- ----------------------------------------------------------------------------

drop view if exists public_forms cascade;
create view public_forms as
  select
    id, team_id, title, slug, description, display_mode, status,
    theme, access_type, languages, default_language,
    save_and_resume, unique_email, scoring_enabled, show_score_to_respondent,
    published_at, closes_at, created_at, updated_at,
    -- On expose seulement le FAIT qu'un mot de passe existe, jamais sa valeur.
    (access_password is not null and access_password <> '') as requires_password
  from forms
  where status = 'published'
    and (closes_at is null or closes_at > now());

drop view if exists public_fields cascade;
create view public_fields as
  select f.*
  from fields f
  join forms fo on fo.id = f.form_id
  where fo.status = 'published'
    and (fo.closes_at is null or fo.closes_at > now());

drop view if exists public_logic_rules cascade;
create view public_logic_rules as
  select l.*
  from logic_rules l
  join forms fo on fo.id = l.form_id
  where fo.status = 'published'
    and (fo.closes_at is null or fo.closes_at > now());

grant select on public_forms to anon, authenticated;
grant select on public_fields to anon, authenticated;
grant select on public_logic_rules to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. SUBMISSIONS — plus d'insertion anonyme directe
--
-- Les réponses passent obligatoirement par /api/submit/[slug], qui valide les
-- champs requis, applique un rate limit et hache l'IP. Retirer la policy INSERT
-- publique empêche d'écrire en base en contournant ces contrôles.
-- ----------------------------------------------------------------------------

drop policy if exists "anyone submits to published forms" on submissions;

-- ----------------------------------------------------------------------------
-- 6. PROFILES — plus d'annuaire ouvert
--
-- Un utilisateur ne voit que son propre profil et celui des membres de ses
-- équipes. La recherche d'un email pour inviter quelqu'un se fait côté serveur
-- avec la clé service_role, dans /api/members.
-- ----------------------------------------------------------------------------

drop policy if exists "Authenticated users can read profiles" on public.profiles;

create policy "users read own and teammate profiles" on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from team_members mine
      join team_members theirs on theirs.team_id = mine.team_id
      where mine.user_id = auth.uid()
        and theirs.user_id = profiles.id
    )
  );

-- ----------------------------------------------------------------------------
-- 7. TEAM_MEMBERS — la policy `for all` d'origine permettait à un admin de
--    s'auto-promouvoir sur n'importe quelle équipe via un INSERT non contrôlé
--    (le `with check` manquait). On la remplace par des policies explicites.
-- ----------------------------------------------------------------------------

drop policy if exists "admins manage members" on team_members;

create policy "admins insert members" on team_members for insert
  with check (is_team_admin(team_id));

create policy "admins update members" on team_members for update
  using (is_team_admin(team_id))
  with check (is_team_admin(team_id));

create policy "admins delete members" on team_members for delete
  using (is_team_admin(team_id));

-- ----------------------------------------------------------------------------
-- 8. STORAGE — bucket des pièces jointes non-média
--
-- Rappel de la règle Mooove : images et vidéos vont sur Cloudflare R2, jamais
-- ici. Ce bucket ne sert qu'aux documents (PDF, DOCX, XLSX…).
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('form-documents', 'form-documents', true, 26214400) -- 25 Mo
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- Lecture publique : un document joint à un formulaire doit rester consultable
-- par son destinataire sans authentification.
drop policy if exists "anyone reads documents" on storage.objects;
create policy "anyone reads documents" on storage.objects for select
  using (bucket_id = 'form-documents');

-- Aucune policy INSERT : les écritures passent exclusivement par
-- /api/uploads/document, qui s'authentifie avec la clé service_role après avoir
-- vérifié les droits, validé le type MIME et appliqué un rate limit. Autoriser
-- l'INSERT direct au rôle anon rouvrirait un dépôt de fichiers ouvert.
drop policy if exists "authenticated upload documents" on storage.objects;
