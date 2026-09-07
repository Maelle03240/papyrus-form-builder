import { describe, it, expect } from 'vitest';
import { normalizeProjectModules } from '@/lib/store/projects';
import { DEFAULT_PROJECT_MODULES } from '@/types';

/**
 * Les modules d'un projet commandent les onglets visibles. Ils viennent d'une
 * colonne jsonb, où rien ne garantit la forme : ces tests fixent la règle qui
 * empêche un onglet d'apparaître ou de disparaître selon la ligne lue.
 */
describe('normalizeProjectModules', () => {
  it('donne tous les modules désactivés sur une valeur absente', () => {
    expect(normalizeProjectModules(null)).toEqual(DEFAULT_PROJECT_MODULES);
    expect(normalizeProjectModules(undefined)).toEqual(DEFAULT_PROJECT_MODULES);
    expect(normalizeProjectModules({})).toEqual(DEFAULT_PROJECT_MODULES);
  });

  it('complète les clés manquantes par « désactivé », jamais par undefined', () => {
    const modules = normalizeProjectModules({ pricing: true });

    expect(modules.pricing).toBe(true);
    expect(modules.partners).toBe(false);
    expect(modules.invoicing).toBe(false);
    expect(modules.email).toBe(false);

    // Le point qui compte : aucune clé ne doit valoir `undefined`, sinon un
    // `modules.partners && …` se comporte différemment d'une ligne à l'autre.
    for (const value of Object.values(modules)) {
      expect(typeof value).toBe('boolean');
    }
  });

  it('ignore une valeur qui n’est pas un booléen', () => {
    // Une colonne jsonb accepte n'importe quoi : une chaîne « true » ne doit pas
    // activer un module par la petite porte de la véracité JavaScript.
    const modules = normalizeProjectModules({ pricing: 'true', partners: 1, email: null });

    expect(modules.pricing).toBe(false);
    expect(modules.partners).toBe(false);
    expect(modules.email).toBe(false);
  });

  it('laisse tomber les clés inconnues', () => {
    const modules = normalizeProjectModules({ pricing: true, teleportation: true });

    expect(Object.keys(modules).sort()).toEqual(Object.keys(DEFAULT_PROJECT_MODULES).sort());
  });

  it('ne renvoie jamais la constante partagée', () => {
    // Sans copie, activer un module sur un projet l'activerait sur tous les
    // suivants lus dans la même page.
    const modules = normalizeProjectModules({});
    modules.pricing = true;

    expect(DEFAULT_PROJECT_MODULES.pricing).toBe(false);
  });

  it('accepte une valeur qui n’est pas un objet', () => {
    expect(normalizeProjectModules('pricing')).toEqual(DEFAULT_PROJECT_MODULES);
    expect(normalizeProjectModules(42)).toEqual(DEFAULT_PROJECT_MODULES);
  });
});
