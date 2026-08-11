-- ============================================================================
-- Papyrus — Migration V1.1 (Refonte de la Logique Conditionnelle)
-- Refactorisation de la table logic_rules pour supporter plusieurs conditions
-- ============================================================================

-- 1. Supprimer les anciennes colonnes (Postgres supprime automatiquement les contraintes associées)
ALTER TABLE logic_rules DROP COLUMN IF EXISTS source_field_id;
ALTER TABLE logic_rules DROP COLUMN IF EXISTS condition;
ALTER TABLE logic_rules DROP COLUMN IF EXISTS condition_value;

-- 2. Ajouter les nouvelles colonnes
ALTER TABLE logic_rules ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE logic_rules ADD COLUMN IF NOT EXISTS conditions_operator text CHECK (conditions_operator IN ('AND', 'OR')) DEFAULT 'AND';
