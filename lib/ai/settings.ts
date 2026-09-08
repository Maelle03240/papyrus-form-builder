import 'server-only';

import { createAdminClient } from '@/lib/supabase/server';
import { decryptSecret, encryptSecret, maskSecret } from '@/lib/crypto';

/**
 * Les réglages IA d'un espace de travail : la clé, le modèle, le budget.
 *
 * Tout passe par `service_role` — et c'est le seul module qui a le droit de le
 * faire sans vérifier lui-même les droits de l'appelant, parce qu'il ne les
 * connaît pas : ce sont ses appelants (les routes) qui les vérifient, et la
 * table `ai_settings` ne porte AUCUNE policy. Un navigateur ne peut pas
 * l'atteindre, même chiffrée.
 */

/** Le modèle par défaut, vérifié disponible sur la clé du compte. */
export const DEFAULT_MODEL = 'gpt-5.6-terra';

/**
 * Les modèles proposés dans les réglages.
 *
 * Une liste courte, et non l'inventaire complet du fournisseur : trois lignes
 * qu'on peut lire valent mieux que quarante identifiants dont personne ne sait
 * ce qu'ils changent. Un identifiant absent de la liste reste acceptable —
 * `model` est une colonne texte, pas une énumération.
 */
export const SUGGESTED_MODELS = [
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', hint: 'Le plus capable. Recommandé.' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', hint: 'Plus rapide, un peu moins fin.' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', hint: 'Le plus économique.' }
] as const;

/** Ce que l'application a le droit de savoir des réglages. Jamais la clé. */
export interface AiSettingsView {
  configured: boolean;
  enabled: boolean;
  key_hint: string;
  model: string;
  monthly_budget_usd: number | null;
  price_input_per_mtok: number;
  price_output_per_mtok: number;
  /** Dépense du mois calendaire en cours, en dollars. */
  spent_this_month: number;
  /** Le chiffrement est-il configuré sur cette instance ? */
  encryption_ready: boolean;
}

interface SettingsRow {
  team_id: string;
  encrypted_api_key: string;
  key_hint: string;
  model: string;
  enabled: boolean;
  monthly_budget_usd: string | number | null;
  price_input_per_mtok: string | number;
  price_output_per_mtok: string | number;
}

/**
 * `numeric` revient de PostgREST en CHAÎNE, pas en nombre.
 *
 * C'est délibéré côté PostgreSQL — un `numeric` peut dépasser la précision d'un
 * flottant. Le comparer tel quel à un budget donnerait `"5.00" > 3` évalué sur
 * du texte, donc faux une fois sur deux selon les chiffres.
 */
function toNumber(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function readAiSettings(teamId: string): Promise<AiSettingsView> {
  const admin = createAdminClient();

  const [{ data }, { data: spent }] = await Promise.all([
    admin.from('ai_settings').select('*').eq('team_id', teamId).maybeSingle(),
    admin.rpc('ai_spend_this_month', { p_team: teamId })
  ]);

  const row = data as SettingsRow | null;
  const { isEncryptionConfigured } = await import('@/lib/crypto');

  return {
    configured: Boolean(row?.encrypted_api_key),
    enabled: row?.enabled === true,
    key_hint: row?.key_hint ?? '',
    model: row?.model || DEFAULT_MODEL,
    monthly_budget_usd:
      row?.monthly_budget_usd === null || row?.monthly_budget_usd === undefined
        ? null
        : toNumber(row.monthly_budget_usd),
    price_input_per_mtok: toNumber(row?.price_input_per_mtok),
    price_output_per_mtok: toNumber(row?.price_output_per_mtok),
    spent_this_month: toNumber(spent as string | number | null),
    encryption_ready: isEncryptionConfigured()
  };
}

export interface AiSettingsPatch {
  /** Clé en clair. Absente = inchangée ; chaîne vide = effacée. */
  api_key?: string;
  enabled?: boolean;
  model?: string;
  monthly_budget_usd?: number | null;
  price_input_per_mtok?: number;
  price_output_per_mtok?: number;
}

export async function writeAiSettings(
  teamId: string,
  userId: string,
  patch: AiSettingsPatch
): Promise<void> {
  const row: Record<string, unknown> = { team_id: teamId, created_by: userId };

  if (patch.api_key !== undefined) {
    const key = patch.api_key.trim();
    // Une chaîne vide efface la clé ET l'indice : laisser « sk-…a3f9 » à
    // l'écran après une suppression ferait croire à une clé encore en place.
    row.encrypted_api_key = key ? encryptSecret(key) : '';
    row.key_hint = key ? maskSecret(key) : '';
    // Une clé effacée éteint l'assistant : le laisser allumé produirait une
    // erreur d'authentification à chaque message, sans dire pourquoi.
    if (!key) row.enabled = false;
  }

  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.model !== undefined) row.model = patch.model.trim() || DEFAULT_MODEL;
  if (patch.monthly_budget_usd !== undefined) row.monthly_budget_usd = patch.monthly_budget_usd;
  if (patch.price_input_per_mtok !== undefined) {
    row.price_input_per_mtok = Math.max(0, patch.price_input_per_mtok);
  }
  if (patch.price_output_per_mtok !== undefined) {
    row.price_output_per_mtok = Math.max(0, patch.price_output_per_mtok);
  }

  const { error } = await createAdminClient()
    .from('ai_settings')
    .upsert(row, { onConflict: 'team_id' });

  if (error) throw error;
}

/** Ce dont l'orchestrateur a besoin pour parler au fournisseur. */
export interface AiRuntime {
  apiKey: string;
  model: string;
  priceInput: number;
  priceOutput: number;
}

export type AiRuntimeResult =
  | { ok: true; runtime: AiRuntime }
  /** `reason` est destiné à l'écran : il dit quoi faire, pas ce qui a planté. */
  | { ok: false; reason: string };

/**
 * Prépare un tour : clé, modèle, et vérification du plafond.
 *
 * Le budget est vérifié AVANT l'appel, jamais après. Refuser un tour coûte une
 * phrase à l'écran ; s'en apercevoir après coup coûte l'appel lui-même, et le
 * plafond n'aurait alors jamais servi à rien.
 */
export async function resolveAiRuntime(teamId: string): Promise<AiRuntimeResult> {
  const admin = createAdminClient();

  const { data } = await admin
    .from('ai_settings')
    .select('*')
    .eq('team_id', teamId)
    .maybeSingle();

  const row = data as SettingsRow | null;

  if (!row || !row.encrypted_api_key) {
    return {
      ok: false,
      reason: 'Aucune clé n’est configurée pour cet espace. Ajoutez-la dans Paramètres → Assistant.'
    };
  }

  if (!row.enabled) {
    return { ok: false, reason: 'L’assistant est désactivé pour cet espace de travail.' };
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(row.encrypted_api_key);
  } catch (error) {
    // Le cas concret : `APP_ENCRYPTION_KEY` a changé entre l'enregistrement et
    // la lecture. La clé est illisible pour toujours ; le dire vaut mieux que
    // de laisser croire à une panne passagère.
    console.error('Déchiffrement de la clé IA impossible:', error);
    return {
      ok: false,
      reason: 'La clé enregistrée est illisible. Ressaisissez-la dans Paramètres → Assistant.'
    };
  }

  const budget = row.monthly_budget_usd === null ? null : toNumber(row.monthly_budget_usd);

  if (budget !== null && budget > 0) {
    const { data: spent } = await admin.rpc('ai_spend_this_month', { p_team: teamId });
    const used = toNumber(spent as string | number | null);

    if (used >= budget) {
      return {
        ok: false,
        reason: `Le budget mensuel de l’assistant est atteint (${used.toFixed(
          2
        )} $ sur ${budget.toFixed(2)} $). Il se remet à zéro le 1er du mois.`
      };
    }
  }

  return {
    ok: true,
    runtime: {
      apiKey,
      model: row.model || DEFAULT_MODEL,
      priceInput: toNumber(row.price_input_per_mtok),
      priceOutput: toNumber(row.price_output_per_mtok)
    }
  };
}

/**
 * Enregistre ce qu'un tour a consommé.
 *
 * Le coût est figé ici, avec les tarifs en vigueur au moment de l'appel — même
 * raison que l'instantané de prix d'une réponse : recalculer un historique
 * après un changement de tarif ferait varier le passé.
 *
 * N'échoue jamais bruyamment. Une écriture de comptabilité ratée ne doit pas
 * effacer une réponse que l'utilisateur a déjà sous les yeux.
 */
export async function recordAiUsage(params: {
  teamId: string;
  userId: string | null;
  conversationId: string | null;
  runtime: AiRuntime;
  inputTokens: number;
  outputTokens: number;
}): Promise<number> {
  const cost =
    (params.inputTokens / 1_000_000) * params.runtime.priceInput +
    (params.outputTokens / 1_000_000) * params.runtime.priceOutput;

  try {
    await createAdminClient()
      .from('ai_usage')
      .insert({
        team_id: params.teamId,
        user_id: params.userId,
        conversation_id: params.conversationId,
        model: params.runtime.model,
        input_tokens: params.inputTokens,
        output_tokens: params.outputTokens,
        cost_usd: Number(cost.toFixed(6))
      });
  } catch (error) {
    console.error('Enregistrement de la consommation IA échoué:', error);
  }

  return cost;
}
