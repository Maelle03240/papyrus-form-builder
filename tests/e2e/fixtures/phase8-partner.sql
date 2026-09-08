-- ============================================================================
-- Parcours partenaire, côté visiteur (phase 8).
--
-- Trois pages publiques et rien d'autre : la page d'accueil d'un lien
-- (`/a/<code>`), le formulaire qu'elle promeut avec le code en paramètre, et la
-- page d'auto-inscription d'un partenaire (`/a/join/<token>`).
--
-- Ce qui se vérifie ici ne se vérifie nulle part ailleurs : l'attribution part
-- d'un clic dans un e-mail, traverse une page d'accueil, un paramètre d'URL et
-- un envoi — et c'est seulement au bout que la commission existe. Les tests
-- unitaires fixent le calcul du registre, la base fixe le rattachement ; entre
-- les deux, il n'y a que ce chemin-là.
--
-- Deux codes, volontairement : celui du projet, et celui d'un SECOND projet.
-- Le second sert à prouver qu'un code valide mais étranger au formulaire est
-- ignoré sans bloquer l'envoi — une réponse perdue coûterait plus cher qu'une
-- commission mal attribuée.
--
-- Application :
--   scp tests/e2e/fixtures/phase8-partner.sql mooove-vps:/tmp/f.sql
--   ssh mooove-vps "docker cp /tmp/f.sql main_supabase-db-1:/tmp/f.sql \
--     && docker exec main_supabase-db-1 psql -U supabase_admin -d postgres -f /tmp/f.sql"
--
-- Suppression après vérification — ces formulaires sont publiés :
--   delete from papyrus.projects where id in (
--     'ffffffff-0000-4000-8000-0000000008b1', 'ffffffff-0000-4000-8000-0000000008b2');
--   delete from papyrus.partners where id = 'ffffffff-0000-4000-8000-0000000008c1';
--
-- Le script se rejoue : il supprime tout avant de le recréer.
-- ============================================================================

set search_path = papyrus, public;

do $$
declare
  tid uuid;
  pid uuid := 'ffffffff-0000-4000-8000-0000000008b1';
  pid2 uuid := 'ffffffff-0000-4000-8000-0000000008b2';
  fid uuid := 'ffffffff-0000-4000-8000-0000000008f2';
  partner uuid := 'ffffffff-0000-4000-8000-0000000008c1';
  sid uuid;
begin
  select team_id into tid from papyrus.forms
    where project_id is not null order by created_at limit 1;

  if tid is null then
    raise exception 'Aucun formulaire existant : impossible de deviner un espace de travail.';
  end if;

  delete from papyrus.projects where id in (pid, pid2);
  delete from papyrus.partners where id = partner;

  -- Le projet promu : partenaires actifs, commission à 10 %, lien
  -- d'auto-inscription ouvert.
  insert into papyrus.projects (id, team_id, name, description, modules,
      partner_config, partner_join_token)
    values (pid, tid, 'Sonde partenaires',
      'Projet de contrôle, supprimé après vérification.',
      '{"pricing":true,"partners":true,"invoicing":false,"email":false}'::jsonb,
      jsonb_build_object(
        -- `enabled` et `self_register` ne sont pas décoratifs : les deux vues
        -- publiques les exigent. Sans eux, `/a/<code>` répond 404 — le module
        -- partenaire existe dans le projet, mais rien n'est ouvert au public.
        'enabled', true,
        'self_register', true,
        'commission_percent', 10,
        'heading', jsonb_build_object('fr', 'Le grand départ 2026'),
        'message', jsonb_build_object('fr', 'Inscrivez-vous auprès de notre partenaire.'),
        'cta_label', jsonb_build_object('fr', 'Je m’inscris'),
        'partner_label', jsonb_build_object('fr', 'En partenariat avec')),
      'sonde8jointoken');

  -- Le second projet : il n'existe que pour porter un code étranger.
  insert into papyrus.projects (id, team_id, name, modules)
    values (pid2, tid, 'Sonde partenaires — voisin',
      '{"pricing":false,"partners":true,"invoicing":false,"email":false}'::jsonb);

  insert into papyrus.forms (id, team_id, project_id, title, slug, description,
      display_mode, status, published_at, theme, access_type, languages, default_language)
    values (fid, tid, pid, 'Inscription — sonde partenaires', 'sonde-partenaire-e8',
      'Formulaire de contrôle, supprimé après vérification.',
      'scroll', 'published', now(),
      '{"bg":"#EFF9FE","accent":"#2AC2DE","font":"sans"}'::jsonb,
      'public', array['fr'], 'fr');

  insert into papyrus.sections (form_id, title, section_order)
    values (fid, '{"fr":"Vos coordonnées"}'::jsonb, 0) returning id into sid;

  insert into papyrus.fields (form_id, section_id, type, label, field_order, required)
    values (fid, sid, 'short_text', '{"fr":"Nom complet"}'::jsonb, 0, true);

  insert into papyrus.fields (form_id, section_id, type, label, field_order, required)
    values (fid, sid, 'email', '{"fr":"Adresse e-mail"}'::jsonb, 1, true);

  insert into papyrus.partners (id, team_id, name, email, website, status)
    values (partner, tid, 'Agence Corail', 'corail@exemple.mu',
      'https://exemple.mu', 'active');

  -- Le code du projet promu, et celui du voisin. Le second est valide, actif,
  -- et n'a rien à faire sur ce formulaire-ci.
  insert into papyrus.project_partners (project_id, partner_id, code, status)
    values (pid, partner, 'sonde8corail', 'active');

  insert into papyrus.project_partners (project_id, partner_id, code, status)
    values (pid2, partner, 'sonde8voisin', 'active');
end $$;
