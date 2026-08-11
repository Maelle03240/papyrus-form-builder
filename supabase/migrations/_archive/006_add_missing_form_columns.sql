-- ============================================================================
-- Papyrus — Migration 006 : Ajout des colonnes manquantes dans la table forms
-- Ajoute les colonnes de scoring, de paramétrage de soumission, et de modèles
-- ============================================================================

ALTER TABLE forms 
  ADD COLUMN IF NOT EXISTS scoring_enabled boolean default false,
  ADD COLUMN IF NOT EXISTS save_and_resume boolean default true,
  ADD COLUMN IF NOT EXISTS unique_email boolean default false,
  ADD COLUMN IF NOT EXISTS show_score_to_respondent boolean default false,
  ADD COLUMN IF NOT EXISTS scope text DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS template_category text,
  ADD COLUMN IF NOT EXISTS template_description text,
  ADD COLUMN IF NOT EXISTS template_icon text;
