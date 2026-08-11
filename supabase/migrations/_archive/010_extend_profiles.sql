-- ============================================================================
-- Papyrus — Migration 010 : Extension de la table profiles
-- Ajoute les champs pour le profil utilisateur complet
-- ============================================================================

-- Ajouter les champs manquants à la table profiles
alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists updated_at timestamptz default now();

-- Policy pour permettre aux utilisateurs de modifier leur propre profil
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using (auth.uid() = id);

-- Trigger pour mettre à jour updated_at automatiquement
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_profiles_updated_at on public.profiles;
create trigger update_profiles_updated_at
  before update on public.profiles
  for each row
  execute function update_updated_at_column();