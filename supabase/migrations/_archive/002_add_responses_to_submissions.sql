-- ============================================================================
-- Papyrus — Migration 002 : Ajout colonne responses aux submissions
-- Ajoute une colonne JSONB pour stocker les réponses aux champs
-- ============================================================================

-- Ajouter colonne responses à la table submissions
ALTER TABLE submissions
ADD COLUMN IF NOT EXISTS responses JSONB DEFAULT '{}' NOT NULL;

-- Commentaire pour documenter la structure attendue
COMMENT ON COLUMN submissions.responses IS 'Réponses aux champs stockées au format: {"field_id": "valeur", ...}';