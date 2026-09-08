-- Phase 8 — durcissement des droits.
--
-- Trois constats, tirés d'une revue table par table de la base de production :
--
-- 1. `anon` porte encore DELETE, INSERT, UPDATE, TRUNCATE et TRIGGER sur les
--    tables du socle (`forms`, `fields`, `submissions`, `teams`, `profiles`…).
--    Rien ne passe aujourd'hui — les policies exigent toutes `is_team_member()`,
--    faux pour un visiteur sans session. Mais un droit accordé n'attend qu'une
--    policy trop large pour devenir une porte : la seule chose qui sépare un
--    visiteur anonyme de la suppression de tous les formulaires est la clause
--    d'une policy. Le visiteur n'a besoin de RIEN sur les tables : il lit les
--    vues `public_*`, qui appartiennent au propriétaire du schéma et se
--    filtrent elles-mêmes.
--
-- 2. `team_invitations` n'a que des policies de LECTURE, alors que l'écran
--    Paramètres → Équipe y insère, y modifie et y supprime depuis le
--    navigateur. Inviter un collègue échoue donc, et échouait déjà avant cette
--    phase. Trois policies manquantes, une par commande.
--
-- 3. Les droits de `authenticated` dépassent partout ses policies : INSERT sur
--    `submissions` (qui n'a aucune policy d'insertion — une réponse n'entre que
--    par `/api/submit`), TRUNCATE et REFERENCES un peu partout. On les ramène à
--    ce que les policies autorisent réellement, pour que lire les droits d'une
--    table dise la vérité sur ce qu'on peut y faire.
--
-- Rien ici ne change une policy existante : ce sont des droits retirés et trois
-- policies ajoutées.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Invitations d'équipe — les trois policies d'écriture manquantes
-- ════════════════════════════════════════════════════════════════════════════

-- Par commande, jamais `for all` : une policy unique confondrait « supprimer
-- une invitation » et « la créer », qui n'ont pas les mêmes conséquences.
drop policy if exists invitations_admin_insert on papyrus.team_invitations;
create policy invitations_admin_insert on papyrus.team_invitations
  for insert with check (papyrus.is_team_admin(team_id));

drop policy if exists invitations_admin_update on papyrus.team_invitations;
create policy invitations_admin_update on papyrus.team_invitations
  for update using (papyrus.is_team_admin(team_id))
  with check (papyrus.is_team_admin(team_id));

drop policy if exists invitations_admin_delete on papyrus.team_invitations;
create policy invitations_admin_delete on papyrus.team_invitations
  for delete using (papyrus.is_team_admin(team_id));

-- ════════════════════════════════════════════════════════════════════════════
-- 2. `anon` ne touche plus aucune table
-- ════════════════════════════════════════════════════════════════════════════

-- Le rôle anonyme lit exclusivement les vues publiques. Ses droits sur les
-- tables sont retirés en bloc — y compris SELECT : `public_forms` et ses
-- sœurs appartiennent à `supabase_admin` et n'ont pas besoin que l'appelant
-- ait quoi que ce soit sur `forms`.
revoke all on all tables in schema papyrus from anon;

-- Les vues, elles, restent lisibles : c'est toute la surface publique.
grant select on papyrus.public_forms to anon;
grant select on papyrus.public_sections to anon;
grant select on papyrus.public_fields to anon;
grant select on papyrus.public_logic_rules to anon;
grant select on papyrus.public_partner_links to anon;
grant select on papyrus.public_partner_join to anon;

-- Et rien de futur ne lui revient par défaut.
alter default privileges in schema papyrus revoke all on tables from anon;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. `authenticated` — les droits alignés sur les policies
-- ════════════════════════════════════════════════════════════════════════════

-- On repart de zéro table par table plutôt que de retirer au cas par cas : la
-- liste ci-dessous est alors lisible comme un inventaire, et non comme un
-- historique de corrections.
revoke all on all tables in schema papyrus from authenticated;

-- Le socle : formulaires et leur contenu.
grant select, insert, update, delete on papyrus.teams to authenticated;
grant select, insert, update, delete on papyrus.team_members to authenticated;
grant select, insert, update, delete on papyrus.team_invitations to authenticated;
grant select, insert, update, delete on papyrus.projects to authenticated;
grant select, insert, update, delete on papyrus.forms to authenticated;
grant select, insert, update, delete on papyrus.sections to authenticated;
grant select, insert, update, delete on papyrus.fields to authenticated;
grant select, insert, update, delete on papyrus.logic_rules to authenticated;
grant select, insert, update, delete on papyrus.form_integrations to authenticated;

-- `profiles` : on lit l'annuaire de son équipe, on ne modifie que le sien.
-- Ni INSERT ni DELETE — une fiche naît avec le compte (`handle_new_user`) et
-- meurt avec lui.
grant select, update on papyrus.profiles to authenticated;

-- `submissions` : pas d'INSERT. Une réponse n'entre que par `/api/submit`,
-- qui la valide, la tarife et la gèle. Un formulaire rempli depuis la console
-- du navigateur d'un membre contournerait tout cela.
grant select, update, delete on papyrus.submissions to authenticated;

-- Les instantanés ne se modifient pas : c'est ce qui en fait des instantanés.
grant select, insert, delete on papyrus.form_versions to authenticated;

-- Partenaires et contacts.
grant select, insert, update, delete on papyrus.partners to authenticated;
grant select, insert, update, delete on papyrus.project_partners to authenticated;
grant select, insert, update, delete on papyrus.contacts to authenticated;
-- Les clics sont comptés par une fonction `security definer`, jamais insérés
-- depuis un navigateur.
grant select, delete on papyrus.partner_clicks to authenticated;

-- Assistant : la conversation appartient à l'équipe, la consommation se lit
-- mais ne s'écrit pas, et `ai_settings` n'est accessible à personne (aucune
-- policy — seule la clé de service la lit, côté serveur).
grant select, insert, update, delete on papyrus.ai_conversations to authenticated;
grant select, insert, delete on papyrus.ai_messages to authenticated;
grant select on papyrus.ai_usage to authenticated;

-- Lecture seule : ces tables sont écrites par des routes serveur.
grant select on papyrus.app_settings to authenticated;
grant select on papyrus.app_admins to authenticated;
grant select on papyrus.tally_imports to authenticated;
grant select on papyrus.integration_events to authenticated;

-- Les vues du portail partenaire et celles du public.
grant select on papyrus.public_forms to authenticated;
grant select on papyrus.public_sections to authenticated;
grant select on papyrus.public_fields to authenticated;
grant select on papyrus.public_logic_rules to authenticated;
grant select on papyrus.public_partner_links to authenticated;
grant select on papyrus.public_partner_join to authenticated;
grant select on papyrus.partner_portal_links to authenticated;
grant select on papyrus.partner_registrations to authenticated;
grant select on papyrus.partner_open_projects to authenticated;

-- Les séquences restent nécessaires aux insertions.
grant usage, select on all sequences in schema papyrus to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Fonctions
-- ════════════════════════════════════════════════════════════════════════════

-- `current_partner_ids` est `security definer` : exécutable par PUBLIC, elle
-- l'était aussi par `anon`. Elle ne renvoie rien sans session — mais une
-- fonction qui lit `partners` n'a aucune raison d'être appelable sans compte.
revoke all on function papyrus.current_partner_ids() from public;
grant execute on function papyrus.current_partner_ids() to authenticated, service_role;

-- `service_role` garde tout : c'est lui qui écrit les réponses, les factures,
-- la consommation et les clics.
grant all on all tables in schema papyrus to service_role;
grant all on all sequences in schema papyrus to service_role;
