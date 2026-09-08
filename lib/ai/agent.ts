import 'server-only';

import OpenAI, { APIError } from 'openai';

import { runTool, toolsForOpenAI, TOOLS_BY_NAME, type ToolContext } from './tools';
import { snapshotFormForAi } from './snapshot';
import type { AiRuntime } from './settings';

/**
 * L'orchestrateur.
 *
 * Il tient une boucle : le modèle demande des outils, on les exécute, on lui
 * rend les résultats, il continue. Deux garde-fous la bornent, et ils sont là
 * pour des raisons différentes :
 *
 *  · **le nombre d'appels d'outils par tour** — un modèle qui se trompe peut
 *    boucler indéfiniment sur le même appel, et chaque tour est facturé ;
 *  · **l'instantané avant la première écriture** — tout ce qu'un tour modifie
 *    se défait d'un seul geste.
 *
 * Ce que l'orchestrateur ne fait PAS : écrire en base. Il ne connaît que des
 * noms d'outils et des arguments ; ce sont les outils qui écrivent, sous la
 * session de l'utilisateur, donc sous RLS.
 */

/**
 * Plafond d'appels d'outils pour un seul message.
 *
 * Trente : de quoi construire un formulaire d'une vingtaine de questions d'une
 * traite, ce qui est la demande la plus courante, sans laisser une boucle
 * dépenser sans fin.
 */
const MAX_TOOL_CALLS = 30;

/** Plafond d'allers-retours avec le modèle, indépendamment du nombre d'outils. */
const MAX_ROUNDS = 12;

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; ok: boolean; message: string }
  | { type: 'snapshot'; version_id: string }
  | { type: 'error'; message: string }
  | {
      type: 'done';
      input_tokens: number;
      output_tokens: number;
      /** L'ancrage en fin de tour : l'IA a pu créer puis ouvrir un formulaire. */
      project_id: string | null;
      form_id: string | null;
    };

export interface AgentTurn {
  runtime: AiRuntime;
  context: ToolContext;
  /** L'historique, du plus ancien au plus récent. */
  history: { role: 'user' | 'assistant'; content: string }[];
  message: string;
  userName: string;
}

/**
 * Les instructions.
 *
 * Elles disent surtout ce qu'il ne faut PAS faire, parce que c'est là que les
 * modèles dérapent : inventer un identifiant plutôt que d'aller le lire,
 * supprimer sans demander, publier sans qu'on l'ait demandé.
 */
export function agentInstructions(ctx: ToolContext): string {
  return [
    'Tu es l’assistant de Papyrus, un constructeur de formulaires. Tu construis en appelant des outils, un geste à la fois.',
    '',
    'Règles :',
    '· Tu n’inventes JAMAIS un identifiant. Pour agir sur une question, une section, une option ou une règle existante, appelle d’abord describe_form et sers-toi des identifiants qu’il rend.',
    '· Avant toute suppression (delete_field, delete_section, delete_logic_rule), demande confirmation dans ta réponse et attends le message suivant. N’enchaîne pas.',
    '· Ne publie un formulaire que si on te le demande.',
    '· Écris les libellés en français, sauf demande contraire. Sois bref : une question de formulaire est courte.',
    '· Un formulaire d’inscription commence par ce qui identifie la personne (nom, e-mail), puis ce qu’elle choisit, puis le reste.',
    '· Si une demande est ambiguë au point de changer la structure, pose UNE question et arrête-toi. Sinon, construis.',
    '· Quand tu as fini, dis en une ou deux phrases ce que tu viens de faire. Ne récapitule pas question par question : la personne voit le formulaire.',
    '',
    ctx.formId
      ? `Formulaire ouvert : ${ctx.formId}.`
      : 'Aucun formulaire ouvert pour l’instant.',
    ctx.projectId ? `Projet ouvert : ${ctx.projectId}.` : 'Aucun projet ouvert pour l’instant.'
  ].join('\n');
}

/**
 * Joue un tour complet et émet ses événements au fil de l'eau.
 *
 * Générateur asynchrone plutôt que rappels : la route peut ainsi transformer
 * chaque événement en ligne SSE sans que l'orchestrateur sache qu'il existe un
 * navigateur au bout.
 */
export async function* runAgentTurn(turn: AgentTurn): AsyncGenerator<AgentEvent> {
  const client = new OpenAI({ apiKey: turn.runtime.apiKey });

  // Le type d'entrée de l'API Responses mélange messages et résultats d'outils ;
  // `unknown[]` ici, parce que le SDK n'exporte pas d'union utilisable pour un
  // tableau qu'on construit à la main.
  const input: Record<string, unknown>[] = [
    ...turn.history.map((entry) => ({ role: entry.role, content: entry.content })),
    { role: 'user', content: turn.message }
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let toolCallCount = 0;
  let snapshotTaken = false;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let stream;
    try {
      stream = await client.responses.create({
        model: turn.runtime.model,
        instructions: agentInstructions(turn.context),
        input: input as never,
        tools: toolsForOpenAI() as never,
        stream: true
      });
    } catch (error) {
      // Clé refusée, modèle inconnu, quota du fournisseur : trois causes que
      // l'utilisateur peut corriger, et qu'il faut donc distinguer d'une panne.
      const message =
        error instanceof APIError
          ? providerMessage(error)
          : 'Le service d’IA est injoignable. Réessayez dans un instant.';
      yield { type: 'error', message };
      return;
    }

    const calls: { call_id: string; name: string; arguments: string }[] = [];

    try {
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
          yield { type: 'text', delta: event.delta };
        } else if (event.type === 'response.completed') {
          const usage = event.response.usage;
          inputTokens += usage?.input_tokens ?? 0;
          outputTokens += usage?.output_tokens ?? 0;

          for (const item of event.response.output ?? []) {
            if (item.type === 'function_call') {
              calls.push({
                call_id: item.call_id,
                name: item.name,
                arguments: item.arguments
              });
            }
            // Les items déjà émis en flux sont réinjectés tels quels : l'API
            // Responses est sans état, et omettre le tour précédent ferait
            // « oublier » au modèle qu'il vient d'appeler un outil.
            input.push(item as unknown as Record<string, unknown>);
          }
        } else if (event.type === 'response.failed') {
          yield {
            type: 'error',
            message: event.response.error?.message ?? 'Le modèle a interrompu sa réponse.'
          };
          return;
        }
      }
    } catch (error) {
      console.error('Flux IA interrompu:', error);
      yield { type: 'error', message: 'La réponse a été interrompue. Réessayez.' };
      return;
    }

    if (calls.length === 0) break;

    for (const call of calls) {
      if (toolCallCount >= MAX_TOOL_CALLS) {
        yield {
          type: 'error',
          message: `Limite de ${MAX_TOOL_CALLS} actions atteinte pour un seul message. Ce qui a été fait est conservé — demandez la suite dans un nouveau message.`
        };
        break;
      }
      toolCallCount += 1;

      // L'instantané est pris une seule fois, juste avant la PREMIÈRE écriture
      // du tour. Avant chaque outil, il en produirait trente ; au début du
      // tour, il en produirait un pour une simple question de lecture.
      const tool = TOOLS_BY_NAME.get(call.name);
      if (tool?.mutates && !snapshotTaken && turn.context.formId) {
        snapshotTaken = true;
        const versionId = await snapshotFormForAi(
          turn.context.supabase,
          turn.context.formId,
          'Avant intervention de l’assistant',
          turn.context.userId,
          turn.userName
        );
        if (versionId) yield { type: 'snapshot', version_id: versionId };
      }

      let parsed: unknown = {};
      try {
        parsed = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        parsed = {};
      }

      const result = await runTool(call.name, parsed, turn.context);

      yield { type: 'tool', name: call.name, ok: result.ok, message: result.message };

      input.push({
        type: 'function_call_output',
        call_id: call.call_id,
        // Le modèle reçoit le message ET les données : sans les données,
        // describe_form ne lui apprendrait rien.
        output: JSON.stringify({ ok: result.ok, message: result.message, data: result.data })
      });
    }

    if (toolCallCount >= MAX_TOOL_CALLS) break;
  }

  yield {
    type: 'done',
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    project_id: turn.context.projectId,
    form_id: turn.context.formId
  };
}

/** Traduit une erreur du fournisseur en phrase actionnable. */
function providerMessage(error: APIError): string {
  switch (error.status) {
    case 401:
      return 'La clé d’API est refusée. Vérifiez-la dans Paramètres → Assistant.';
    case 404:
      return 'Ce modèle n’existe pas sur votre compte. Changez-le dans Paramètres → Assistant.';
    case 429:
      return 'Le fournisseur limite les appels ou votre crédit est épuisé. Réessayez plus tard.';
    default:
      return 'Le service d’IA a refusé la demande. Réessayez dans un instant.';
  }
}
