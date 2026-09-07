-- ============================================================================
-- Formulaire de contrôle des e-mails et de la facturation (phase 4).
--
-- Il réunit tout ce qui se déclenche APRÈS l'envoi : un numéro tiré de la
-- séquence du projet, un message par défaut, un message conditionnel qui le
-- remplace, un écran de remerciement rédigé, et des totaux à faire figurer sur
-- le bon de commande.
--
-- C'est le support de `tests/e2e/phase4-emails.spec.ts`. Rien de tout cela ne se
-- vérifie ailleurs : les tests unitaires fixent le choix du message et le rendu
-- des jetons, la base fixe l'attribution du numéro, et entre les deux il n'y a
-- que ceci.
--
-- Le projet créé porte son propre compteur : il ne touche à aucune séquence
-- existante, et sa suppression l'emporte avec lui.
--
-- Application :
--   scp tests/e2e/fixtures/phase4-emails.sql mooove-vps:/tmp/f.sql
--   ssh mooove-vps "docker cp /tmp/f.sql main_supabase-db-1:/tmp/f.sql \
--     && docker exec main_supabase-db-1 psql -U supabase_admin -d postgres -f /tmp/f.sql"
--
-- Suppression après vérification — ce formulaire est publié, donc accessible à
-- qui connaît son adresse :
--   delete from papyrus.projects where id = 'ffffffff-0000-4000-8000-0000000004a2';
--
-- Le script se rejoue : il supprime le projet avant de le recréer.
-- ============================================================================

set search_path = papyrus, public;

do $$
declare
  tid uuid;
  pid uuid := 'ffffffff-0000-4000-8000-0000000004a2';
  fid uuid := 'ffffffff-0000-4000-8000-0000000004f2';
  sid uuid;
  email_id uuid; formule_id uuid;
begin
  select team_id into tid from papyrus.forms
    where project_id is not null order by created_at limit 1;

  if tid is null then
    raise exception 'Aucun formulaire existant : impossible de deviner un espace de travail.';
  end if;

  delete from papyrus.projects where id = pid;

  -- Projet : facturation active, sa propre séquence, TVA à 15 %.
  insert into papyrus.projects (id, team_id, name, description, modules, pricing,
      invoice_prefix, invoice_next, invoice_pad)
    values (pid, tid, 'Sonde e-mails', 'Projet de controle, supprime apres verification.',
      '{"pricing":true,"partners":false,"invoicing":true,"email":true}'::jsonb,
      '{"currency":"MUR","currency_position":"before","vat_enabled":true,"vat_rate":15}'::jsonb,
      'SONDE', 1, 4);

  insert into papyrus.forms (id, team_id, project_id, title, slug, description,
      display_mode, status, published_at, theme, access_type, languages,
      default_language, pricing_config, email_config, confirmation_config)
    values (fid, tid, pid, 'Sonde e-mails', 'sonde-emails-e4',
      'Formulaire de controle, supprime apres verification.',
      'scroll', 'published', now(),
      '{"bg":"#EFF9FE","accent":"#2AC2DE","font":"sans"}'::jsonb,
      'public', array['fr'], 'fr',
      '{"enabled":true}'::jsonb,

      -- Message par défaut, plus une règle qui le remplace quand la formule
      -- choisie est la table. L'ordre compte : la première règle qui correspond
      -- gagne.
      jsonb_build_object(
        'enabled', true,
        'attach_pdf', true,
        'from_name', 'Sonde',
        'default_message', jsonb_build_object(
          'subject', jsonb_build_object('fr', 'Votre inscription {{invoice_number}}'),
          'body', jsonb_build_object('fr',
            '<p>Bonjour {{prenom}}, votre inscription est enregistree. Total : {{total}}.</p>')),
        'rules', jsonb_build_array(
          jsonb_build_object(
            'id', 'r-table',
            'label', 'Table complete',
            'when', jsonb_build_object('operator','AND','conditions', jsonb_build_array(
              jsonb_build_object('source_field_id','FORMULE','operator','equals','value','o-table'))),
            'message', jsonb_build_object(
              'subject', jsonb_build_object('fr', 'Votre table est reservee'),
              'body', jsonb_build_object('fr', '<p>Merci {{prenom}}, la table est a vous.</p>'))))),

      jsonb_build_object(
        'title', jsonb_build_object('fr', 'Inscription enregistree'),
        'message', jsonb_build_object('fr', 'A bientot, {{prenom}}.'),
        'show_reference', true,
        'reference_label', jsonb_build_object('fr', 'Votre reference'),
        'email_note', jsonb_build_object('fr', 'Un e-mail vient de vous etre envoye.')));

  insert into papyrus.sections (form_id, title, section_order)
    values (fid, '{"fr":"Vos informations"}'::jsonb, 0) returning id into sid;

  insert into papyrus.fields (form_id, section_id, type, label, field_order, required)
    values (fid, sid, 'short_text', '{"fr":"Prenom"}'::jsonb, 0, true);

  insert into papyrus.fields (form_id, section_id, type, label, field_order, required)
    values (fid, sid, 'email', '{"fr":"Adresse e-mail"}'::jsonb, 1, true)
    returning id into email_id;

  insert into papyrus.fields (form_id, section_id, type, label, field_order, options)
    values (fid, sid, 'single_choice', '{"fr":"Formule"}'::jsonb, 2,
      jsonb_build_array(
        jsonb_build_object('id','o-table','label', jsonb_build_object('fr','Table de 6'), 'price', 3000),
        jsonb_build_object('id','o-place','label', jsonb_build_object('fr','Place seule'), 'price', 600)))
    returning id into formule_id;

  -- Les identifiants de champ sont générés en base : les gabarits et la règle
  -- les citent, donc ils sont réécrits une fois connus. Écrire l'inverse — poser
  -- les identifiants à la main — reviendrait à figer des UUID dans un fichier
  -- rejouable.
  update papyrus.forms set
    email_config = replace(email_config::text, 'FORMULE', formule_id::text)::jsonb,
    confirmation_config = replace(confirmation_config::text, '{{prenom}}',
      '{{' || (select id::text from papyrus.fields
                where form_id = fid and type = 'short_text' limit 1) || '}}')::jsonb
  where id = fid;

  update papyrus.forms set
    email_config = replace(email_config::text, '{{prenom}}',
      '{{' || (select id::text from papyrus.fields
                where form_id = fid and type = 'short_text' limit 1) || '}}')::jsonb
  where id = fid;

  -- Le champ e-mail sert de destinataire désigné.
  update papyrus.forms set
    email_config = jsonb_set(email_config, '{to_field_id}', to_jsonb(email_id::text))
  where id = fid;
end $$;
