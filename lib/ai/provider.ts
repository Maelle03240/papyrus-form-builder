// lib/ai/provider.ts — Façade IA interchangeable Claude / OpenAI

type AIProvider = 'claude' | 'openai';

const PROVIDER = (process.env.AI_PROVIDER as AIProvider) ?? 'claude';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Complétion texte simple. Le provider est sélectionné via AI_PROVIDER.
 * NB: les implémentations concrètes (claude.ts, openai.ts) seront ajoutées
 * dès qu'on installe @anthropic-ai/sdk ou openai. Pour l'instant on stub.
 */
export async function complete(_prompt: string, _systemPrompt?: string): Promise<string> {
  if (PROVIDER === 'openai') {
    throw new Error('Provider OpenAI non encore implémenté — installer `openai` puis créer lib/ai/openai.ts');
  }
  throw new Error('Provider Claude non encore implémenté — installer `@anthropic-ai/sdk` puis créer lib/ai/claude.ts');
}

/** Traduit un schéma de formulaire vers une langue cible — JSON in / JSON out. */
export async function translateForm(formSchema: object, targetLanguage: string): Promise<object> {
  const prompt = `Tu es un traducteur expert. Traduis tous les textes de ce schéma de formulaire vers ${targetLanguage}.
Réponds UNIQUEMENT en JSON valide avec la même structure.
Schéma : ${JSON.stringify(formSchema)}`;
  const result = await complete(prompt);
  return JSON.parse(result);
}

/** Analyse les réponses et retourne un résumé en 3-5 points. */
export async function analyzeResponses(responses: object[], fields: object[]): Promise<string> {
  const prompt = `Analyse ces réponses de formulaire et donne un résumé en 3-5 points clés avec des insights actionnables.
Champs : ${JSON.stringify(fields)}
Réponses (échantillon) : ${JSON.stringify(responses.slice(0, 50))}`;
  return complete(prompt);
}

/** Suggère un type de graphique pertinent pour un champ donné. */
export async function suggestChartType(field: object, sampleData: unknown[]): Promise<string> {
  const prompt = `Quel type de graphique est le plus adapté pour visualiser ce champ de formulaire ?
Champ : ${JSON.stringify(field)}
Données exemple : ${JSON.stringify(sampleData.slice(0, 20))}
Réponds UNIQUEMENT avec un de ces types : bar, pie, line, number, word_cloud, table`;
  return complete(prompt);
}
