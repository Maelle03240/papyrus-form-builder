-- ============================================================================
-- Formulaire de contrôle de la tarification (phase 3).
--
-- Il réunit tout ce qui produit un montant : un prix par option, un compteur de
-- quantité, un bloc répétable dont chaque ligne se facture, un montant libre qui
-- compte dans le total, un code de réduction, la TVA et un tarif dégressif.
--
-- C'est le support de `tests/e2e/phase3-pricing.spec.ts`. Le calcul en direct et
-- le gel des totaux à l'envoi ne se vérifient nulle part ailleurs : les tests
-- unitaires fixent le moteur, la base fixe le stockage, et entre les deux il n'y
-- a que ceci.
--
-- Application :
--   scp tests/e2e/fixtures/phase3-pricing.sql mooove-vps:/tmp/f.sql
--   ssh mooove-vps "docker cp /tmp/f.sql main_supabase-db-1:/tmp/f.sql \
--     && docker exec main_supabase-db-1 psql -U supabase_admin -d postgres -f /tmp/f.sql"
--
-- Suppression après vérification — ce formulaire est publié, donc accessible à
-- qui connaît son adresse :
--   delete from papyrus.forms where id = 'ffffffff-0000-4000-8000-00000000e3e3';
--
-- Le script se rejoue : il supprime le formulaire avant de le recréer.
-- ============================================================================

set search_path = papyrus, public;

do $$
declare
  tid uuid; pid uuid;
  fid uuid := 'ffffffff-0000-4000-8000-00000000e3e3';
  sid uuid; rep uuid;
begin
  select team_id, project_id into tid, pid from papyrus.forms
    where project_id is not null and id <> fid
    order by created_at limit 1;

  if tid is null then
    raise exception 'Aucun formulaire existant : impossible de deviner un espace de travail.';
  end if;

  delete from papyrus.forms where id = fid;

  insert into papyrus.forms (id, team_id, project_id, title, slug, description,
      display_mode, status, published_at, theme, access_type, languages,
      default_language, pricing_config)
    values (fid, tid, pid, 'Sonde tarification', 'sonde-tarification-e2e',
      'Formulaire de controle, supprime apres verification.',
      'scroll', 'published', now(),
      '{"bg":"#EFF9FE","accent":"#2AC2DE","font":"sans"}'::jsonb,
      'public', array['fr'], 'fr',
      jsonb_build_object(
        'enabled', true,
        'currency', 'MUR',
        'currency_position', 'before',
        'vat_enabled', true,
        'vat_rate', 15,
        'discount_enabled', true,
        'discounts', jsonb_build_array(
          jsonb_build_object('id', 'd1', 'code', 'EARLY20', 'percent', 20)
        )
      ));

  insert into papyrus.sections (form_id, title, section_order)
    values (fid, '{"fr":"Votre venue"}'::jsonb, 0) returning id into sid;

  -- Option payante simple, avec compteur de quantite.
  insert into papyrus.fields (form_id, section_id, type, label, field_order, options, pricing)
    values (fid, sid, 'single_choice', '{"fr":"Formule"}'::jsonb, 0,
      jsonb_build_array(
        jsonb_build_object('id','o-table','label', jsonb_build_object('fr','Table de 6'), 'price', 3000),
        jsonb_build_object('id','o-place','label', jsonb_build_object('fr','Place seule'), 'price', 600),
        jsonb_build_object('id','o-libre','label', jsonb_build_object('fr','Entree libre'))
      ),
      '{"quantity":{"enabled":true,"min":1,"max":10}}'::jsonb);

  -- Bloc repetable : chaque ligne porte son menu, donc son prix.
  insert into papyrus.fields (form_id, section_id, type, label, field_order, repeater)
    values (fid, sid, 'repeater', '{"fr":"Participants"}'::jsonb, 1,
      jsonb_build_object(
        'min', 1, 'max', 4,
        'item_label', jsonb_build_object('fr','Participant'),
        'fields', jsonb_build_array(
          jsonb_build_object(
            'id','nom','type','short_text',
            'label', jsonb_build_object('fr','Nom'),
            'description', jsonb_build_object('fr',''),
            'placeholder', jsonb_build_object('fr',''),
            'options', jsonb_build_array(), 'required', false, 'validation', '{}'::jsonb),
          jsonb_build_object(
            'id','menu','type','single_choice',
            'label', jsonb_build_object('fr','Menu'),
            'description', jsonb_build_object('fr',''),
            'placeholder', jsonb_build_object('fr',''),
            'required', false, 'validation', '{}'::jsonb,
            'options', jsonb_build_array(
              jsonb_build_object('id','m-viande','label', jsonb_build_object('fr','Viande'), 'price', 800),
              jsonb_build_object('id','m-veg','label', jsonb_build_object('fr','Vegetarien'), 'price', 700)))
        )))
    returning id into rep;

  -- Montant libre qui s'ajoute au total.
  insert into papyrus.fields (form_id, section_id, type, label, field_order, validation, pricing)
    values (fid, sid, 'currency', '{"fr":"Don libre"}'::jsonb, 2,
      '{"currency_code":"MUR"}'::jsonb, '{"count_in_total":true}'::jsonb);

  -- Option payante masquee par un verrou : elle ne doit jamais etre facturee
  -- quand la question qui la commande dit non.
  insert into papyrus.fields (form_id, section_id, type, label, field_order)
    values (fid, sid, 'yesno', '{"fr":"Navette souhaitee ?"}'::jsonb, 3);

  insert into papyrus.fields (form_id, section_id, type, label, field_order, options, visibility)
    values (fid, sid, 'single_choice', '{"fr":"Navette"}'::jsonb, 4,
      jsonb_build_array(
        jsonb_build_object('id','n-aller','label', jsonb_build_object('fr','Aller simple'), 'price', 250)),
      jsonb_build_object('operator','AND','conditions', jsonb_build_array(
        jsonb_build_object(
          'source_field_id',
          (select id::text from papyrus.fields
             where form_id = fid and type = 'yesno' limit 1),
          'operator','equals','value','yes'))));
end $$;
