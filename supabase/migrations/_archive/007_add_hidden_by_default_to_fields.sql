-- ============================================================================
-- Papyrus — Migration 007 : Ajout de hidden_by_default dans la table fields
-- ============================================================================

ALTER TABLE fields 
  ADD COLUMN IF NOT EXISTS hidden_by_default boolean default false;
