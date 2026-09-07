-- ============================================================================
-- Papyrus — phase 2 : parité des champs et visibilité conditionnelle
--
-- Dix nouveaux types de champ, et un second mécanisme d'affichage : le verrou
-- de visibilité, porté par le champ ou la section lui-même.
--
-- Pourquoi deux mécanismes plutôt qu'un. `logic_rules` s'écrit depuis la
-- question source (« quand on répond oui ici, montrer là-bas ») ; c'est le point
-- de vue du parcours, et c'est le seul qui sache faire un saut de page. Le
-- verrou s'écrit depuis l'élément cible (« ne m'affiche que si… ») ; c'est le
-- seul point de vue praticable quand une même question dépend de trois autres,
-- et c'est celui de mooove-invoice. Les deux se combinent par un ET : un élément
-- est visible si la logique le dit visible ET que son verrou s'ouvre. Un verrou
-- ne peut donc jamais forcer l'apparition de ce qu'une règle masque.
--
-- Ce fichier est idempotent : il peut être rejoué sans dommage.
-- ============================================================================

set search_path = papyrus, public;

-- ============================================================================
-- 1. Les dix nouveaux types de champ
-- ============================================================================

alter table papyrus.fields drop constraint if exists fields_type_check;
alter table papyrus.fields add constraint fields_type_check check (type in (
  -- Existants
  'short_text', 'long_text', 'email', 'phone', 'number', 'url',
  'single_choice', 'multiple_choice', 'dropdown', 'rating', 'nps',
  'date', 'file', 'statement', 'image', 'video', 'matrix',
  -- Phase 2
  'currency',   -- montant, avec symbole monétaire
  'address',    -- adresse postale libre, sur plusieurs lignes
  'country',    -- liste des pays
  'yesno',      -- deux boutons
  'signature',  -- signature tracée à la main, déposée sur R2
  'repeater',   -- bloc de sous-questions dupliqué par le répondant
  'calculated', -- valeur calculée, en lecture seule
  'link',       -- lien ou bouton d'affichage, ne collecte rien
  'hidden',     -- valeur pré-remplie depuis la chaîne de requête
  'divider'     -- filet de séparation
));

-- ============================================================================
-- 2. Le verrou de visibilité
--
-- Forme : `{"conditions": [...], "operator": "AND"}`. Un objet vide — la valeur
-- par défaut — signifie « aucune condition », donc toujours visible.
-- ============================================================================

alter table papyrus.fields
  add column if not exists visibility jsonb not null default '{}'::jsonb;

alter table papyrus.sections
  add column if not exists visibility jsonb not null default '{}'::jsonb;

-- Une section retirée du formulaire mais conservée dans le constructeur. Ce
-- n'est pas un verrou fermé : c'est une décision de l'auteur, qu'aucune
-- combinaison de réponses ne vient rouvrir.
alter table papyrus.sections
  add column if not exists hidden boolean not null default false;

-- ============================================================================
-- 3. Structures propres à deux types
--
-- `repeater` et `calc` sont les seuls réglages de phase 2 à obtenir une colonne.
-- Les autres — l'URL d'un lien, le code monétaire, la clé de requête d'un champ
-- caché — rejoignent `fields.validation`, qui est déjà le sac de configuration
-- d'un champ et non ses seules contraintes de saisie. Ces deux-là portent une
-- structure, pas un réglage : un répéteur contient ses propres sous-champs.
-- ============================================================================

alter table papyrus.fields add column if not exists repeater jsonb;
alter table papyrus.fields add column if not exists calc jsonb;

-- ============================================================================
-- 4. Vues publiques
--
-- PostgreSQL développe le `select *` au moment de la création d'une vue et fige
-- la liste des colonnes. Sans cette recréation, `public_fields` n'exposerait ni
-- `visibility`, ni `repeater`, ni `calc`, et `public_sections` ni `visibility`
-- ni `hidden` : le répondant verrait toutes les questions conditionnelles à la
-- fois, les répéteurs sans leurs sous-questions, et les sections masquées par
-- leur auteur. Sans la moindre erreur pour le signaler.
--
-- C'est le même piège qu'en migration 004. Il vaut pour toute colonne ajoutée à
-- une table qu'une vue publique expose.
-- ============================================================================

drop view if exists papyrus.public_fields cascade;
create view papyrus.public_fields as
  select f.*
  from papyrus.fields f
  join papyrus.forms fo on fo.id = f.form_id
  where fo.status = 'published' and (fo.closes_at is null or fo.closes_at > now());

drop view if exists papyrus.public_sections cascade;
create view papyrus.public_sections as
  select s.*
  from papyrus.sections s
  join papyrus.forms fo on fo.id = s.form_id
  where fo.status = 'published' and (fo.closes_at is null or fo.closes_at > now());

grant select on papyrus.public_fields to anon, authenticated;
grant select on papyrus.public_sections to anon, authenticated;
