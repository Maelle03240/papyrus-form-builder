-- ============================================================================
-- Papyrus — Migration 004 : Initialiser les équipes manquantes
-- Crée une équipe pour tous les users qui n'en ont pas
-- ============================================================================

-- 1. Créer une équipe pour chaque utilisateur sans équipe
INSERT INTO teams (name)
SELECT DISTINCT 'Mon équipe'
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.user_id = u.id
);

-- 2. Associer ces users comme admins de leur équipe
WITH users_without_teams AS (
  SELECT u.id
  FROM auth.users u
  WHERE NOT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.user_id = u.id
  )
),
latest_team_for_each_user AS (
  SELECT DISTINCT ON (u.id) u.id as user_id, t.id as team_id
  FROM users_without_teams u
  CROSS JOIN teams t
  WHERE t.name = 'Mon équipe'
  ORDER BY u.id, t.created_at DESC
)
INSERT INTO team_members (user_id, team_id, role)
SELECT user_id, team_id, 'admin'
FROM latest_team_for_each_user
ON CONFLICT (user_id, team_id) DO NOTHING;
