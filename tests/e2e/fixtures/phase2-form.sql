-- ============================================================================
-- Formulaire de contrôle des champs de la phase 2.
--
-- Il porte un exemplaire de chaque type ajouté, dont un bloc répétable verrouillé
-- par la question qui le précède et un total qui en compte les lignes. C'est le
-- support de `tests/e2e/phase2-fields.spec.ts` — ces trois comportements vivent
-- dans le navigateur du répondant et ne se vérifient nulle part ailleurs.
--
-- Application :
--   scp tests/e2e/fixtures/phase2-form.sql mooove-vps:/tmp/f.sql
--   ssh mooove-vps "docker cp /tmp/f.sql main_supabase-db-1:/tmp/f.sql --     && docker exec main_supabase-db-1 psql -U supabase_admin -d postgres -f /tmp/f.sql"
--
-- Puis :
--   E2E_BASE_URL=... E2E_FORM_SLUG=sonde-phase-2-e2e npx playwright test
--
-- Suppression, une fois la vérification faite — ce formulaire est publié, donc
-- accessible à qui connaît son adresse :
--   delete from papyrus.forms where id = 'ffffffff-0000-4000-8000-00000000e2e2';
--
-- Le script se rejoue : il supprime le formulaire avant de le recréer. Il reprend
-- l'espace de travail et le projet d'un formulaire existant, pour ne pas avoir à
-- en inventer.
-- ============================================================================

set search_path = papyrus, public;
do $$
declare
  tid uuid; pid uuid; fid uuid := 'ffffffff-0000-4000-8000-00000000e2e2'; sid uuid;
  gate uuid; rep uuid;
begin
  select team_id, project_id into tid, pid from papyrus.forms
    where project_id is not null and id <> fid
    order by created_at limit 1;

  if tid is null then
    raise exception 'Aucun formulaire existant : impossible de deviner un espace de travail.';
  end if;

  delete from papyrus.forms where id = fid;

  insert into papyrus.forms (id, team_id, project_id, title, slug, description,
      display_mode, status, published_at, theme, access_type, languages, default_language)
    values (fid, tid, pid, 'Sonde phase 2', 'sonde-phase-2-e2e', 'Formulaire de controle, supprime apres verification.',
      'scroll', 'published', now(), '{"bg":"#EFF9FE","accent":"#2AC2DE","font":"sans"}'::jsonb,
      'public', array['fr'], 'fr');

  insert into papyrus.sections (form_id, title, section_order)
    values (fid, '{"fr":"Sonde"}'::jsonb, 0) returning id into sid;

  insert into papyrus.fields (form_id, section_id, type, label, field_order, validation)
    values (fid, sid, 'hidden', '{"fr":"Canal"}'::jsonb, 0,
      '{"hidden_key":"utm_source","hidden_default":"direct"}'::jsonb);

  insert into papyrus.fields (form_id, section_id, type, label, field_order, validation)
    values (fid, sid, 'yesno', '{"fr":"Venez-vous accompagne ?"}'::jsonb, 1, '{}'::jsonb)
    returning id into gate;

  insert into papyrus.fields (form_id, section_id, type, label, field_order, repeater, visibility)
    values (fid, sid, 'repeater', '{"fr":"Accompagnants"}'::jsonb, 2,
      '{"min":1,"max":4,"item_label":{"fr":"Accompagnant"},"fields":[{"id":"nom","type":"short_text","label":{"fr":"Nom"},"description":{"fr":""},"placeholder":{"fr":""},"options":[],"required":false,"validation":{}}]}'::jsonb,
      jsonb_build_object('operator','AND','conditions',
        jsonb_build_array(jsonb_build_object('source_field_id', gate::text, 'operator','equals','value','yes'))))
    returning id into rep;

  insert into papyrus.fields (form_id, section_id, type, label, field_order, calc)
    values (fid, sid, 'calculated', '{"fr":"Total personnes"}'::jsonb, 3,
      jsonb_build_object('mode','count','sources', jsonb_build_array(rep::text), 'offset', 1));

  insert into papyrus.fields (form_id, section_id, type, label, field_order, validation)
    values (fid, sid, 'currency', '{"fr":"Contribution"}'::jsonb, 4, '{"currency_code":"MUR"}'::jsonb);

  insert into papyrus.fields (form_id, section_id, type, label, field_order, validation)
    values (fid, sid, 'country', '{"fr":"Pays"}'::jsonb, 5, '{"default_country_code":"MU"}'::jsonb);

  insert into papyrus.fields (form_id, section_id, type, label, field_order, validation)
    values (fid, sid, 'link', '{"fr":"Voir le programme"}'::jsonb, 6,
      '{"link_url":"https://mooove.group","link_variant":"button","link_new_tab":true}'::jsonb);

  insert into papyrus.fields (form_id, section_id, type, label, field_order)
    values (fid, sid, 'divider', '{"fr":""}'::jsonb, 7);

  insert into papyrus.fields (form_id, section_id, type, label, field_order, validation)
    values (fid, sid, 'address', '{"fr":"Adresse"}'::jsonb, 8, '{"address_rows":3}'::jsonb);
end $$;
