/**
 * Sérialisation à clés triées, utilisée pour détecter les modifications.
 *
 * `JSON.stringify` ne suffit pas : les réglages d'un formulaire vivent dans des
 * colonnes `jsonb`, et PostgreSQL y réordonne les clés. Comparer la version
 * relue à celle qu'on vient d'envoyer produirait donc deux chaînes différentes
 * pour des données identiques, et la barre « modifications non enregistrées »
 * réapparaîtrait aussitôt après chaque enregistrement.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    // Une clé absente et une clé à `undefined` doivent se valoir : JSON.stringify
    // omet la seconde, on fait de même.
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}
