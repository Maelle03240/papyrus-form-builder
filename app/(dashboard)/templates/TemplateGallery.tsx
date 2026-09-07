'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { Building2, Eye, Globe, LayoutTemplate, Search, Sparkles, Star, User, X } from 'lucide-react';
import type { Form } from '@/types';
import type { TemplateIndexEntry } from '@/lib/templates/types';
import { useForms } from '@/lib/store/use-forms';
import { cloneTemplate, fetchGlobalTemplate, listLocalTemplatesByScope } from '@/lib/store/templates';
import { FAVORITES_EVENT, listFavorites, toggleFavorite } from '@/lib/store/favorites';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { TemplateCard, modeLabel } from '@/components/templates/TemplateCard';
import { TemplateFilters, FILTER_PREDICATES, type TemplateFilterKey } from '@/components/templates/TemplateFilters';
import { ALL_CATEGORIES, CategoryRail } from '@/components/templates/CategoryRail';
import { TemplatePreviewDrawer } from '@/components/templates/TemplatePreviewDrawer';
import { TemplateEmptyState, type TemplateTab } from '@/components/templates/TemplateEmptyState';
import { resolveTemplateIcon } from '@/components/templates/template-icons';

/**
 * Galerie de modèles.
 *
 * L'index complet (~37 Ko) arrive en props depuis le Server Component : c'est
 * tout ce dont la grille a besoin. La définition d'un modèle — questions,
 * options, règles — n'est chargée qu'à l'ouverture de l'aperçu ou au clic sur
 * « Utiliser ».
 */

const TABS: { value: TemplateTab; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { value: 'personal', label: 'Mes modèles', icon: User, hint: 'Ce que vous avez créé' },
  { value: 'workspace', label: "Modèles de l'équipe", icon: Building2, hint: 'Partagés dans votre espace de travail' },
  { value: 'global', label: 'Modèles Mooove', icon: Globe, hint: 'Bibliothèque officielle' }
];

export function TemplateGallery({ index }: { index: TemplateIndexEntry[] }) {
  const router = useRouter();
  const forms = useForms();

  const [tab, setTab] = useState<TemplateTab>('global');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [filters, setFilters] = useState<Set<TemplateFilterKey>>(new Set());
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [previewing, setPreviewing] = useState<TemplateIndexEntry | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setFavorites(new Set(listFavorites()));
    refresh();
    window.addEventListener(FAVORITES_EVENT, refresh);
    return () => window.removeEventListener(FAVORITES_EVENT, refresh);
  }, []);

  const localBuckets = useMemo(() => listLocalTemplatesByScope(forms), [forms]);

  const matchesSearch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return () => true;
    return (e: TemplateIndexEntry) =>
      e.title.fr.toLowerCase().includes(q) ||
      (e.title.en ?? '').toLowerCase().includes(q) ||
      e.template_description.fr.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q);
  }, [search]);

  /**
   * Le badge de faisabilité n'est pas montré à l'utilisateur — c'est une donnée
   * de pilotage interne. En revanche un modèle `blocked` repose sur un type de
   * champ qui n'existe pas encore : le publier donnerait un formulaire amputé.
   * Il est donc retiré du catalogue visible, ce qui laisse 50 modèles sur 51.
   */
  const publishable = useMemo(() => index.filter((e) => e.feasibility !== 'blocked'), [index]);

  const searched = useMemo(() => publishable.filter(matchesSearch), [publishable, matchesSearch]);

  const filtered = useMemo(() => {
    const active = [...filters];
    return searched.filter((e) => {
      if (category !== ALL_CATEGORIES && e.category !== category) return false;
      return active.every((key) => FILTER_PREDICATES[key](e));
    });
  }, [searched, category, filters]);

  // Les compteurs du rail tiennent compte de la recherche et des filtres
  // secondaires, mais pas de la catégorie sélectionnée : sinon, chaque pastille
  // afficherait zéro dès qu'une autre est active.
  const counts = useMemo(() => {
    const active = [...filters];
    const result: Record<string, number> = {};
    for (const entry of searched) {
      if (!active.every((key) => FILTER_PREDICATES[key](entry))) continue;
      result[entry.category] = (result[entry.category] ?? 0) + 1;
    }
    return result;
  }, [searched, filters]);

  const railTotal = useMemo(
    () => Object.values(counts).reduce((sum, n) => sum + n, 0),
    [counts]
  );

  const favouriteEntries = useMemo(
    () => searched.filter((e) => favorites.has(e.id)),
    [searched, favorites]
  );

  async function createFromGlobalTemplate(entry: TemplateIndexEntry) {
    if (busySlug) return;
    setBusySlug(entry.slug);
    try {
      const form = await fetchGlobalTemplate(entry.slug);
      const cloned = await cloneTemplate(form);
      router.push(`/forms/${cloned.id}/edit`);
    } catch (error) {
      console.error('Failed to clone template:', error);
      toast.error('Impossible de créer le formulaire à partir de ce modèle. Veuillez réessayer.');
      setBusySlug(null);
    }
  }

  async function createFromLocalTemplate(form: Form) {
    if (busySlug) return;
    setBusySlug(form.id);
    try {
      const cloned = await cloneTemplate(form);
      router.push(`/forms/${cloned.id}/edit`);
    } catch (error) {
      console.error('Failed to clone template:', error);
      toast.error('Impossible de créer le formulaire à partir de ce modèle. Veuillez réessayer.');
      setBusySlug(null);
    }
  }

  function handleToggleFavorite(id: string) {
    toggleFavorite(id);
    setFavorites(new Set(listFavorites()));
  }

  function toggleFilter(key: TemplateFilterKey) {
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const localList = tab === 'global' ? [] : localBuckets[tab];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* En-tête */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <LayoutTemplate className="h-7 w-7 text-text-secondary" />
            <h1 className="font-display text-4xl">Modèles</h1>
          </div>
          <p className="papyrus-meta mt-1 text-sm not-italic">
            i. {publishable.length} modèles prêts à l&apos;emploi, en français et en anglais.
          </p>
        </div>
        <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un modèle…" />
      </div>

      {/* Favoris — agrège les modèles Mooove mis en favori */}
      {favouriteEntries.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Star className="h-4 w-4 fill-mooove-electric text-mooove-electric" />
            <h2 className="font-display text-xl">Vos favoris</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {favouriteEntries.map((entry) => (
              <TemplateCard
                key={entry.id}
                entry={entry}
                favorite
                busy={busySlug === entry.slug}
                onUse={() => createFromGlobalTemplate(entry)}
                onPreview={() => setPreviewing(entry)}
                onToggleFavorite={() => handleToggleFavorite(entry.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Onglets */}
      <div className="border-b border-border">
        <div className="flex gap-1">
          {TABS.map(({ value, label, icon: Icon }) => {
            const active = tab === value;
            const count = value === 'global' ? searched.length : localBuckets[value].length;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition',
                  active
                    ? 'border-accent text-text-primary'
                    : 'border-transparent text-text-tertiary hover:text-text-secondary'
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px]',
                    active ? 'bg-accent/10 text-accent' : 'bg-bg-elevated text-text-tertiary'
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'global' ? (
        <>
          {/* Rail et filtres : réservés au catalogue Mooove, seul assez fourni
              pour en avoir besoin. */}
          <CategoryRail
            counts={counts}
            total={railTotal}
            active={category}
            onSelect={setCategory}
          />
          <TemplateFilters
            active={filters}
            onToggle={toggleFilter}
            onReset={() => setFilters(new Set())}
          />

          {filtered.length === 0 ? (
            <TemplateEmptyState tab="global" search={search} onClearSearch={() => setSearch('')} />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((entry) => (
                <TemplateCard
                  key={entry.id}
                  entry={entry}
                  favorite={favorites.has(entry.id)}
                  busy={busySlug === entry.slug}
                  onUse={() => createFromGlobalTemplate(entry)}
                  onPreview={() => setPreviewing(entry)}
                  onToggleFavorite={() => handleToggleFavorite(entry.id)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="papyrus-meta text-xs">
            i. {TABS.find((t) => t.value === tab)?.hint}
          </p>
          {localList.length === 0 ? (
            <TemplateEmptyState tab={tab} search="" onClearSearch={() => setSearch('')} />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {localList.map((form) => (
                <LocalTemplateCard
                  key={form.id}
                  form={form}
                  busy={busySlug === form.id}
                  onUse={() => createFromLocalTemplate(form)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {previewing && (
          <TemplatePreviewDrawer
            entry={previewing}
            busy={busySlug === previewing.slug}
            onClose={() => setPreviewing(null)}
            onUse={() => createFromGlobalTemplate(previewing)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Carte d'un modèle personnel ou d'équipe — grille plate, sans index de catalogue. */
function LocalTemplateCard({
  form,
  busy,
  onUse
}: {
  form: Form;
  busy: boolean;
  onUse: () => void;
}) {
  const Icon = resolveTemplateIcon(form.template_icon);
  const fieldCount = form.fields?.length ?? 0;

  return (
    <div className="group flex flex-col rounded-2xl border border-border bg-bg-surface p-5 transition hover:border-border-strong hover:shadow-xs">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bg-elevated text-text-secondary">
        <Icon className="h-5 w-5" />
      </div>

      <h3 className="mt-3 font-display text-lg leading-tight text-text-primary">{form.title}</h3>
      {form.template_description && (
        <p className="papyrus-meta mt-1 flex-1 text-xs">{form.template_description}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="rounded-sm bg-bg-elevated px-2 py-0.5 text-[10px] text-text-tertiary">
          {fieldCount} champ{fieldCount > 1 ? 's' : ''}
        </span>
        <span className="rounded-sm bg-bg-elevated px-2 py-0.5 text-[10px] text-text-tertiary">
          {modeLabel(form.display_mode)}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-end gap-1.5">
        <a
          href={`/forms/${form.id}`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border-strong px-2.5 py-1.5 text-xs text-text-primary transition hover:border-accent hover:bg-bg-elevated"
        >
          <Eye className="h-3.5 w-3.5" />
          Ouvrir
        </a>
        <button
          type="button"
          onClick={onUse}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-mooove-ice transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {busy ? 'Création…' : 'Utiliser'}
        </button>
      </div>
    </div>
  );
}

function SearchBar({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-border bg-bg-surface pl-8 pr-8 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Effacer la recherche"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-text-tertiary transition hover:bg-bg-elevated hover:text-text-primary"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
