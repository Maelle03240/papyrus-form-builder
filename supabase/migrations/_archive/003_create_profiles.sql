-- ============================================================================
-- Papyrus — Migration 003 : Création de la table profiles
-- Permet de lister les utilisateurs par email pour les invitations d'équipe
-- ============================================================================

-- 1. Table profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Activer RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Policy RLS pour la lecture des profils
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON public.profiles;
CREATE POLICY "Authenticated users can read profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

-- 4. Mettre à jour la fonction handle_new_user pour insérer aussi dans profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_team_id uuid;
BEGIN
  -- Créer le workspace par défaut
  INSERT INTO public.teams (name) VALUES (coalesce(new.raw_user_meta_data->>'team_name', 'Mon équipe'))
  RETURNING id INTO new_team_id;

  -- Associer l'utilisateur comme admin du workspace
  INSERT INTO public.team_members (user_id, team_id, role)
  VALUES (new.id, new_team_id, 'admin');

  -- Insérer dans le profil public
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email);

  RETURN new;
END;
$$;

-- 5. Remplir rétroactivement les profils pour les utilisateurs existants
INSERT INTO public.profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;
