-- ============================================================================
-- Formulaire de contrôle du rendu public (phase 8).
--
-- Il ne sert qu'à une chose : vérifier qu'une question donne son nom au
-- contrôle qui y répond. C'est pour cela qu'il réunit les deux familles côte à
-- côte — les champs à contrôle unique (saisie, liste, date), qui se désignent
-- par `<label for>`, et les questions à plusieurs contrôles (choix, note,
-- oui/non), qui s'annoncent comme des groupes nommés.
--
-- Ce défaut ne se voit sur aucun écran : la page s'affiche parfaitement, et
-- c'est un lecteur d'écran — ou un test qui cherche un champ par son nom — qui
-- découvre qu'aucun contrôle n'en a. D'où ce formulaire, dont les tests
-- désignent chaque champ PAR SON LIBELLÉ et jamais par son invite ou sa
-- position : si le rattachement disparaît, ils ne trouvent plus rien.
--
-- Une question porte une description : elle sert à vérifier `aria-describedby`,
-- qui est ce qui fait entendre « format attendu » avant la saisie plutôt
-- qu'après l'échec.
--
-- Application :
--   scp tests/e2e/fixtures/phase8-public.sql mooove-vps:/tmp/f.sql
--   ssh mooove-vps "docker cp /tmp/f.sql main_supabase-db-1:/tmp/f.sql \
--     && docker exec main_supabase-db-1 psql -U supabase_admin -d postgres -f /tmp/f.sql"
--
-- Suppression après vérification — ce formulaire est publié, donc accessible à
-- qui connaît son adresse :
--   delete from papyrus.projects where id = 'ffffffff-0000-4000-8000-0000000008a1';
--
-- Le script se rejoue : il supprime le projet avant de le recréer.
-- ============================================================================

set search_path = papyrus, public;

do $$
declare
  tid uuid;
  pid uuid := 'ffffffff-0000-4000-8000-0000000008a1';
  fid uuid := 'ffffffff-0000-4000-8000-0000000008f1';
  sid uuid;
begin
  select team_id into tid from papyrus.forms
    where project_id is not null order by created_at limit 1;

  if tid is null then
    raise exception 'Aucun formulaire existant : impossible de deviner un espace de travail.';
  end if;

  delete from papyrus.projects where id = pid;

  insert into papyrus.projects (id, team_id, name, description, modules)
    values (pid, tid, 'Sonde rendu public',
      'Projet de contrôle, supprimé après vérification.',
      '{"pricing":false,"partners":false,"invoicing":false,"email":false}'::jsonb);

  insert into papyrus.forms (id, team_id, project_id, title, slug, description,
      display_mode, status, published_at, theme, access_type, languages, default_language)
    values (fid, tid, pid, 'Sonde rendu public', 'sonde-public-e8',
      'Formulaire de contrôle, supprimé après vérification.',
      'scroll', 'published', now(),
      '{"bg":"#EFF9FE","accent":"#2AC2DE","font":"sans"}'::jsonb,
      'public', array['fr'], 'fr');

  insert into papyrus.sections (form_id, title, section_order)
    values (fid, '{"fr":"Vos réponses"}'::jsonb, 0) returning id into sid;

  -- Contrôle unique : chacun doit porter le nom de sa question.
  insert into papyrus.fields (form_id, section_id, type, label, description, field_order, required)
    values (fid, sid, 'short_text', '{"fr":"Nom complet"}'::jsonb,
      '{"fr":"Tel qu’il figure sur votre pièce d’identité."}'::jsonb, 0, true);

  insert into papyrus.fields (form_id, section_id, type, label, field_order, required)
    values (fid, sid, 'email', '{"fr":"Adresse e-mail"}'::jsonb, 1, true);

  insert into papyrus.fields (form_id, section_id, type, label, field_order)
    values (fid, sid, 'long_text', '{"fr":"Commentaire libre"}'::jsonb, 2);

  insert into papyrus.fields (form_id, section_id, type, label, field_order)
    values (fid, sid, 'number', '{"fr":"Nombre d’accompagnants"}'::jsonb, 3);

  insert into papyrus.fields (form_id, section_id, type, label, field_order)
    values (fid, sid, 'date', '{"fr":"Date d’arrivée"}'::jsonb, 4);

  insert into papyrus.fields (form_id, section_id, type, label, field_order, options)
    values (fid, sid, 'dropdown', '{"fr":"Pays de résidence"}'::jsonb, 5,
      jsonb_build_array(
        jsonb_build_object('id','o-mu','label', jsonb_build_object('fr','Maurice')),
        jsonb_build_object('id','o-fr','label', jsonb_build_object('fr','France'))));

  -- Plusieurs contrôles : la question devient un groupe nommé, jamais un
  -- `<label for>` pointant vers le premier bouton.
  insert into papyrus.fields (form_id, section_id, type, label, field_order, options)
    values (fid, sid, 'single_choice', '{"fr":"Formule choisie"}'::jsonb, 6,
      jsonb_build_array(
        jsonb_build_object('id','o-jour','label', jsonb_build_object('fr','Journée')),
        jsonb_build_object('id','o-soir','label', jsonb_build_object('fr','Soirée'))));

  insert into papyrus.fields (form_id, section_id, type, label, field_order)
    values (fid, sid, 'yesno', '{"fr":"Êtes-vous déjà venu ?"}'::jsonb, 7);

  insert into papyrus.fields (form_id, section_id, type, label, field_order, validation)
    values (fid, sid, 'rating', '{"fr":"Votre satisfaction"}'::jsonb, 8,
      '{"max":5}'::jsonb);
end $$;
