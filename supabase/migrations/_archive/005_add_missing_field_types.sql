-- ============================================================================
-- Papyrus — Migration 005 : Ajout des types de champs manquants
-- Met à jour la contrainte CHECK pour supporter les nouveaux types du builder
-- ============================================================================

-- 1. Supprimer l'ancienne contrainte
ALTER TABLE fields DROP CONSTRAINT IF EXISTS fields_type_check;

-- 2. Recréer la contrainte avec les types manquants ('image', 'video', 'matrix', 'url')
ALTER TABLE fields ADD CONSTRAINT fields_type_check CHECK (type IN (
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'url',
  'single_choice',
  'multiple_choice',
  'dropdown',
  'rating',
  'nps',
  'date',
  'file',
  'section_break',
  'statement',
  'image',
  'video',
  'matrix'
));
