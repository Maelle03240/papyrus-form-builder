'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';

interface Props {
  formId: string;
  /** Conteneur dont on observe les inputs (la modal d'aperçu, ou la page /f/[slug]). */
  containerRef: React.RefObject<HTMLElement | null>;
}

/**
 * Bannière "Vous avez une réponse en cours" + persistance des valeurs des inputs
 * du conteneur dans localStorage. Aucune donnée envoyée tant que le formulaire
 * n'est pas soumis.
 */
export function SaveResumeBar({ formId, containerRef }: Props) {
  const storageKey = `papyrus.draft.${formId}`;
  const [hasDraft, setHasDraft] = useState(false);
  const restoredRef = useRef(false);

  // 1. Au montage, on regarde s'il y a déjà un brouillon stocké
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const draft = window.localStorage.getItem(storageKey);
    setHasDraft(!!draft && draft !== '{}');
  }, [storageKey]);

  // 2. Sur chaque input dans le conteneur, on sauvegarde l'état des champs nommés
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const el = containerRef.current;
    if (!el) return;

    let timer: number | null = null;
    function save() {
      const inputs = el!.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input[name], textarea[name], select[name]'
      );
      const data: Record<string, string | string[]> = {};
      inputs.forEach((input) => {
        const name = input.name;
        if (!name) return;
        if (input instanceof HTMLInputElement && (input.type === 'checkbox' || input.type === 'radio')) {
          if (!input.checked) return;
          if (input.type === 'checkbox') {
            const existing = data[name];
            if (Array.isArray(existing)) existing.push(input.value);
            else if (typeof existing === 'string') data[name] = [existing, input.value];
            else data[name] = [input.value];
          } else {
            data[name] = input.value;
          }
        } else {
          if (input.value === '') return;
          data[name] = input.value;
        }
      });
      window.localStorage.setItem(storageKey, JSON.stringify(data));
    }

    function onInput() {
      // debounce léger pour éviter d'écrire dans le localStorage à chaque touche
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(save, 250);
    }

    el.addEventListener('input', onInput, true);
    el.addEventListener('change', onInput, true);
    return () => {
      el.removeEventListener('input', onInput, true);
      el.removeEventListener('change', onInput, true);
      if (timer) window.clearTimeout(timer);
    };
  }, [containerRef, storageKey]);

  function handleResume() {
    if (typeof window === 'undefined') return;
    const draft = window.localStorage.getItem(storageKey);
    if (!draft) return;
    const data = JSON.parse(draft) as Record<string, string | string[]>;
    const el = containerRef.current;
    if (!el) return;

    Object.entries(data).forEach(([name, value]) => {
      const nodes = el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        `[name="${CSS.escape(name)}"]`
      );
      if (nodes.length === 0) return;
      if (Array.isArray(value)) {
        nodes.forEach((node) => {
          if (node instanceof HTMLInputElement && node.type === 'checkbox') {
            node.checked = value.includes(node.value);
          }
        });
      } else if (nodes[0] instanceof HTMLInputElement && (nodes[0].type === 'radio' || nodes[0].type === 'checkbox')) {
        nodes.forEach((node) => {
          if (node instanceof HTMLInputElement) node.checked = node.value === value;
        });
      } else {
        const node = nodes[0];
        node.value = value;
        // Déclenche l'événement input pour que React voie la nouvelle valeur (si contrôlé)
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    restoredRef.current = true;
    setHasDraft(false);
  }

  function handleRestart() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(storageKey);
    setHasDraft(false);
  }

  if (!hasDraft) return null;

  return (
    <div className="border-b border-warning/30 bg-warning/5 px-4 py-2.5">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Save className="h-4 w-4 shrink-0 text-warning" />
          <span className="text-text-primary">Vous avez une réponse en cours.</span>
          <span className="papyrus-meta text-xs">i. Reprendre où vous en étiez ?</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={handleResume}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-mooove-ice transition hover:opacity-90"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            Reprendre
          </button>
          <button
            type="button"
            onClick={handleRestart}
            className="inline-flex items-center gap-1 rounded-md border border-border-strong px-3 py-1.5 text-xs text-text-primary transition hover:bg-bg-elevated"
          >
            <RotateCcw className="h-3 w-3" /> Recommencer
          </button>
        </div>
      </div>
    </div>
  );
}
