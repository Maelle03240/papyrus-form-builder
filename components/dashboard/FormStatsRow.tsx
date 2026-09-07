'use client';

import { BarChart3, Clock, TrendingUp, Users } from 'lucide-react';

/**
 * Bandeau de chiffres clés d'un formulaire.
 *
 * Extrait de la page `/forms/[id]` pour que l'espace de travail d'un projet
 * puisse l'afficher sans dupliquer le calcul.
 */
export function FormStatsRow({ submissions, loading }: { submissions: any[]; loading: boolean }) {
  const count = loading ? '...' : String(submissions.length);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      <StatCard label="Réponses" value={count} icon={<Users className="h-4 w-4" />} />
      <StatCard label="Vues" value="—" icon={<TrendingUp className="h-4 w-4" />} hint="bientôt" />
      <StatCard
        label="Taux complétion"
        value="—"
        icon={<BarChart3 className="h-4 w-4" />}
        hint="bientôt"
      />
      <StatCard label="Temps moyen" value="—" icon={<Clock className="h-4 w-4" />} hint="bientôt" />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  hint
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-surface p-5">
      <div className="flex items-center gap-2 text-text-secondary">
        {icon}
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-3 font-display text-3xl">{value}</div>
      {hint && <div className="papyrus-meta mt-1 text-xs">{hint}</div>}
    </div>
  );
}

// ============================================================================
// Helper pour ordonner les graphiques du tableau de bord
