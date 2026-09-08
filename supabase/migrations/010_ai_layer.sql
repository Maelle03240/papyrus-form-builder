-- ============================================================================
-- Papyrus — phase 7 : la couche IA
--
-- L'IA de Papyrus n'écrit pas de schéma. Elle appelle des outils, un par un,
-- comme le ferait quelqu'un qui clique. C'est la décision qui commande tout le
-- reste du fichier — et celle que l'ancienne route `/api/generate-form`
-- prenait à l'envers : elle demandait un objet JSON complet à un modèle et
-- l'importait tel quel. Un champ inventé, un identifiant qui ne correspond à
-- rien, une règle logique qui pointe dans le vide : rien ne l'arrêtait, parce
-- qu'il n'y avait aucune étape où quoi que ce soit était vérifié.
--
-- Quatre tables, et une règle de droits qui les distingue :
--
--   ai_settings       la clé, le modèle, le budget — JAMAIS lisible du
--                     navigateur : aucune policy, donc `service_role` seul
--   ai_usage          ce que chaque tour a consommé, lisible par l'équipe
--   ai_conversations  les échanges, lisibles par l'équipe
--   ai_messages       leur contenu
--
-- Ce fichier est idempotent : il peut être rejoué sans dommage.
-- ============================================================================

set search_path = papyrus, public;

-- ============================================================================
-- 1. Réglages IA d'un espace de travail
--
-- La clé est chiffrée par `lib/crypto.ts` (AES-256-GCM, `APP_ENCRYPTION_KEY`),
-- exactement comme la clé Tally : un accès en lecture à la base — sauvegarde
-- égarée, requête depuis Supabase Studio — ne doit pas suffire à la récupérer.
--
-- Aucune policy sur cette table. C'est délibéré et c'est le même choix que
-- `tally_credentials` : rien de ce qu'elle contient n'a de raison d'atteindre
-- un navigateur, pas même chiffré. Les réglages non secrets remontent par une
-- route serveur qui les recopie un par un.
-- ============================================================================

create table if not exists papyrus.ai_settings (
  team_id uuid primary key references papyrus.teams(id) on delete cascade,

  encrypted_api_key text not null default '',
  -- « sk-…a3f9 » : de quoi reconnaître la clé en place sans jamais la relire.
  key_hint text not null default '',

  model text not null default 'gpt-5.6-terra',

  -- Interrupteur distinct de la présence d'une clé : on doit pouvoir couper
  -- l'assistant sans effacer la configuration, et la rallumer sans la ressaisir.
  enabled boolean not null default false,

  -- Budget mensuel, en dollars — la monnaie de facturation d'OpenAI, et non la
  -- roupie du reste du produit. Nul = aucun plafond.
  monthly_budget_usd numeric(10, 2),

  -- Tarifs par million de jetons, saisis par l'équipe.
  --
  -- Ils ne sont pas codés en dur, et c'est une décision : le prix d'un modèle
  -- change, et une table de prix figée dans le dépôt afficherait des montants
  -- faux avec l'aplomb d'un chiffre exact. Les jetons, eux, sont un fait rendu
  -- par l'API. À zéro, le coût vaut zéro et le budget ne peut donc rien
  -- déclencher : l'écran de réglages le dit en toutes lettres plutôt que de
  -- laisser croire à une surveillance qui n'existe pas.
  price_input_per_mtok numeric(10, 4) not null default 0,
  price_output_per_mtok numeric(10, 4) not null default 0,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table papyrus.ai_settings enable row level security;

drop trigger if exists trg_ai_settings_updated_at on papyrus.ai_settings;
create trigger trg_ai_settings_updated_at before update on papyrus.ai_settings
  for each row execute function papyrus.set_updated_at();

-- ============================================================================
-- 2. Consommation
--
-- Une ligne par tour d'assistant. Les jetons sont conservés bruts parce qu'ils
-- sont vérifiables ; le coût est calculé au moment de l'écriture avec les
-- tarifs alors en vigueur, et figé — comme l'instantané de prix d'une réponse
-- en phase 3. Recalculer un historique après un changement de tarif ferait
-- varier le passé.
-- ============================================================================

create table if not exists papyrus.ai_usage (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references papyrus.teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  conversation_id uuid,

  model text not null default '',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  -- Six décimales : un tour court coûte des millièmes de dollar, et arrondir au
  -- centime ferait un total mensuel de zéro sur des milliers d'appels.
  cost_usd numeric(12, 6) not null default 0,

  created_at timestamptz not null default now()
);

create index if not exists ai_usage_team_date_idx
  on papyrus.ai_usage (team_id, created_at desc);

alter table papyrus.ai_usage enable row level security;

-- Lecture pour l'équipe — « combien a-t-on dépensé ce mois-ci » est une question
-- que l'équipe doit pouvoir poser. L'écriture reste au serveur : une ligne de
-- consommation écrite depuis un navigateur ne voudrait rien dire.
drop policy if exists ai_usage_select on papyrus.ai_usage;
create policy ai_usage_select on papyrus.ai_usage for select
  using (papyrus.is_team_member(team_id));

-- ============================================================================
-- 3. Conversations
--
-- Rattachées à l'ÉQUIPE et non à la seule personne qui a parlé. Un formulaire
-- appartient à l'équipe ; savoir pourquoi il a changé de forme la semaine
-- dernière ne doit pas dépendre de qui était devant l'écran ce jour-là.
-- ============================================================================

create table if not exists papyrus.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references papyrus.teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,

  -- L'ancrage de la conversation. Les deux peuvent être nuls : l'assistant de
  -- création parle avant qu'un projet existe.
  project_id uuid references papyrus.projects(id) on delete cascade,
  form_id uuid references papyrus.forms(id) on delete cascade,

  title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_conversations_form_idx
  on papyrus.ai_conversations (form_id, updated_at desc);
create index if not exists ai_conversations_team_idx
  on papyrus.ai_conversations (team_id, updated_at desc);

alter table papyrus.ai_conversations enable row level security;

drop policy if exists ai_conversations_select on papyrus.ai_conversations;
create policy ai_conversations_select on papyrus.ai_conversations for select
  using (papyrus.is_team_member(team_id));

drop policy if exists ai_conversations_insert on papyrus.ai_conversations;
create policy ai_conversations_insert on papyrus.ai_conversations for insert
  with check (papyrus.is_team_member(team_id));

drop policy if exists ai_conversations_update on papyrus.ai_conversations;
create policy ai_conversations_update on papyrus.ai_conversations for update
  using (papyrus.is_team_member(team_id))
  with check (papyrus.is_team_member(team_id));

drop policy if exists ai_conversations_delete on papyrus.ai_conversations;
create policy ai_conversations_delete on papyrus.ai_conversations for delete
  using (papyrus.is_team_member(team_id));

drop trigger if exists trg_ai_conversations_updated_at on papyrus.ai_conversations;
create trigger trg_ai_conversations_updated_at before update on papyrus.ai_conversations
  for each row execute function papyrus.set_updated_at();

-- ============================================================================
-- 4. Messages
--
-- `tool_calls` garde la trace des outils appelés et de ce qu'ils ont répondu.
-- C'est ce qui permet de relire « ce que l'IA a fait », et pas seulement ce
-- qu'elle a dit — la différence entre un journal et une conversation.
-- ============================================================================

create table if not exists papyrus.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references papyrus.ai_conversations(id) on delete cascade,

  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null default '',
  tool_calls jsonb not null default '[]'::jsonb,

  -- Instantané pris juste avant le lot d'outils de ce tour. Une seule action
  -- pour tout annuler, ce que la phase 1 avait préparé en portant
  -- `form_versions` avant l'IA plutôt qu'après.
  version_id uuid references papyrus.form_versions(id) on delete set null,

  created_at timestamptz not null default now()
);

create index if not exists ai_messages_conversation_idx
  on papyrus.ai_messages (conversation_id, created_at);

alter table papyrus.ai_messages enable row level security;

drop policy if exists ai_messages_select on papyrus.ai_messages;
create policy ai_messages_select on papyrus.ai_messages for select
  using (exists (
    select 1 from papyrus.ai_conversations c
    where c.id = ai_messages.conversation_id and papyrus.is_team_member(c.team_id)
  ));

drop policy if exists ai_messages_insert on papyrus.ai_messages;
create policy ai_messages_insert on papyrus.ai_messages for insert
  with check (exists (
    select 1 from papyrus.ai_conversations c
    where c.id = ai_messages.conversation_id and papyrus.is_team_member(c.team_id)
  ));

drop policy if exists ai_messages_delete on papyrus.ai_messages;
create policy ai_messages_delete on papyrus.ai_messages for delete
  using (exists (
    select 1 from papyrus.ai_conversations c
    where c.id = ai_messages.conversation_id and papyrus.is_team_member(c.team_id)
  ));

-- ============================================================================
-- 5. Droits de table
--
-- Explicites, comme en migration 009 : les `alter default privileges` de la
-- migration 001 ne valent que pour les objets créés par le rôle qui les a
-- posés, et ces tables-ci sont créées par `supabase_admin`.
--
-- `ai_settings` ne reçoit RIEN pour `authenticated` : la clé d'API d'une équipe
-- n'a aucune raison d'être atteignable depuis un navigateur, fût-ce chiffrée.
-- ============================================================================

grant all on papyrus.ai_settings to service_role;

grant select on papyrus.ai_usage to authenticated;
grant all on papyrus.ai_usage to service_role;

grant select, insert, update, delete on papyrus.ai_conversations to authenticated;
grant all on papyrus.ai_conversations to service_role;

grant select, insert, delete on papyrus.ai_messages to authenticated;
grant all on papyrus.ai_messages to service_role;

-- ============================================================================
-- 6. Dépense du mois en cours
--
-- Une fonction plutôt qu'un `sum` recopié dans l'application : le plafond est
-- vérifié avant chaque tour ET affiché dans les réglages, et deux additions
-- écrites séparément finissent par ne plus compter la même chose.
--
-- `date_trunc('month', now())` : le mois calendaire, pas les trente derniers
-- jours. Un budget mensuel se remet à zéro le premier du mois, sinon personne
-- ne sait jamais quand il redevient dépensable.
-- ============================================================================

create or replace function papyrus.ai_spend_this_month(p_team uuid)
returns numeric
language sql security definer stable
set search_path = papyrus, public
as $$
  select coalesce(sum(cost_usd), 0)
    from papyrus.ai_usage
   where team_id = p_team
     and created_at >= date_trunc('month', now());
$$;

revoke all on function papyrus.ai_spend_this_month(uuid) from public;
grant execute on function papyrus.ai_spend_this_month(uuid) to service_role, authenticated;

notify pgrst, 'reload schema';
