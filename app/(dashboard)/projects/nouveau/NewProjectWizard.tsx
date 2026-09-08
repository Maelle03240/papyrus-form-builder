'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Award,
  Building2,
  CalendarHeart,
  ClipboardList,
  FileSignature,
  Gauge,
  Receipt,
  Sparkles,
  Ticket
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/Toast';
import { AssistantPanel } from '@/components/ai/AssistantPanel';
import { createProject } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { ProjectModules } from '@/types';

/**
 * L'assistant de création d'un projet.
 *
 * Trois écrans — nom, type, modules — et **« Passer » sur chacun**. C'est la
 * décision qui rend ce questionnaire acceptable : quelqu'un qui sait déjà ce
 * qu'il veut construire ne doit jamais avoir à répondre à trois questions pour
 * y arriver. Un assistant qu'on ne peut pas contourner devient une porte.
 *
 * Les réponses ne sont pas un formulaire déguisé : elles composent la première
 * phrase adressée à l'assistant, qui construit ensuite en appelant ses outils.
 * Passer les trois écrans mène au même endroit, avec une page blanche.
 */

interface Props {
  teamId: string;
}

const KINDS = [
  {
    id: 'survey',
    label: 'Enquête',
    icon: ClipboardList,
    prompt: 'une enquête : des questions ouvertes et à choix, sans paiement'
  },
  {
    id: 'registration',
    label: 'Inscriptions & abonnements',
    icon: Ticket,
    prompt: 'un formulaire d’inscription : identité, choix de formule, et un récapitulatif chiffré'
  },
  {
    id: 'order',
    label: 'Bon de commande & facturation',
    icon: Receipt,
    prompt: 'un bon de commande : articles avec quantités et prix, TVA, et numérotation des commandes'
  },
  {
    id: 'application',
    label: 'Candidature',
    icon: FileSignature,
    prompt: 'un dossier de candidature : identité, parcours, motivation, pièces jointes'
  },
  {
    id: 'quiz',
    label: 'Quiz noté',
    icon: Award,
    prompt: 'un quiz noté : des questions à choix avec des points, et un score à la fin'
  },
  {
    id: 'nps',
    label: 'Satisfaction / NPS',
    icon: Gauge,
    prompt: 'un questionnaire de satisfaction : une question NPS, des notes, et un commentaire libre'
  },
  {
    id: 'event',
    label: 'Invitation événement',
    icon: CalendarHeart,
    prompt: 'une invitation à un événement : présence, nombre d’accompagnants, régime alimentaire'
  },
  {
    id: 'other',
    label: 'Autre',
    icon: Building2,
    prompt: ''
  }
] as const;

const MODULE_LABELS: { key: keyof ProjectModules; label: string; hint: string }[] = [
  { key: 'pricing', label: 'Tarification', hint: 'Des prix, un total, une TVA.' },
  { key: 'invoicing', label: 'Facturation', hint: 'Un numéro de commande par réponse.' },
  { key: 'partners', label: 'Partenaires', hint: 'Des liens de partage et des commissions.' },
  { key: 'email', label: 'E-mails', hint: 'Une confirmation envoyée au répondant.' }
];

export function NewProjectWizard({ teamId }: Props) {
  const router = useRouter();

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]['id'] | null>(null);
  const [modules, setModules] = useState<ProjectModules>({
    pricing: false,
    partners: false,
    invoicing: false,
    email: false
  });

  const [creating, setCreating] = useState(false);
  const [handoff, setHandoff] = useState<{ projectId: string; message: string } | null>(null);

  /**
   * Crée le projet, puis passe la main à l'assistant.
   *
   * Le projet est créé ici et non par l'IA : c'est un geste sûr, immédiat, et
   * il donne à la conversation un ancrage. Sans lui, le premier message
   * devrait commencer par créer un projet, et un échec à mi-parcours
   * laisserait la personne devant une page qui n'existe nulle part.
   */
  async function begin(withAssistant: boolean) {
    setCreating(true);
    try {
      const project = await createProject({
        name: name.trim() || 'Nouveau projet',
        teamId,
        modules
      });

      if (!withAssistant) {
        router.push(`/projects/${project.id}`);
        return;
      }

      setHandoff({ projectId: project.id, message: openingMessage() });
    } catch (error) {
      console.error('Création de projet échouée:', error);
      toast.error("Le projet n'a pas pu être créé.");
      setCreating(false);
    }
  }

  /** La phrase d'ouverture, composée des réponses données — ou de rien. */
  function openingMessage(): string {
    const chosen = KINDS.find((entry) => entry.id === kind);
    const parts: string[] = [];

    parts.push(
      chosen && chosen.prompt
        ? `Construis ${chosen.prompt}.`
        : 'Construis un formulaire pour ce projet.'
    );

    if (name.trim()) parts.push(`Le projet s’appelle « ${name.trim()} ».`);

    const on = MODULE_LABELS.filter((entry) => modules[entry.key]).map((entry) =>
      entry.label.toLowerCase()
    );
    if (on.length > 0) parts.push(`Modules demandés : ${on.join(', ')}.`);

    parts.push('Commence par créer le formulaire, puis pose les questions une à une.');

    return parts.join(' ');
  }

  if (handoff) {
    return (
      <div className="mx-auto flex h-full max-w-3xl flex-col px-6 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-text-secondary">
            Projet créé. L’assistant construit — vous pouvez lui parler.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push(`/projects/${handoff.projectId}`)}
          >
            Ouvrir le projet
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border">
          <AssistantPanel
            teamId={teamId}
            projectId={handoff.projectId}
            formId={null}
            initialMessage={handoff.message}
            onCreated={({ form_id }) => {
              // On ne redirige PAS automatiquement : l'assistant est peut-être
              // encore en train de poser des questions, et changer de page sous
              // les doigts de quelqu'un qui lit est la pire des surprises.
              if (form_id) {
                toast.success('Formulaire créé. Ouvrez le projet pour le voir.');
              }
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">
        <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden />
        Nouveau projet
      </div>

      <StepDots step={step} />

      {step === 0 && (
        <Screen
          title="Comment s’appelle ce projet ?"
          hint="Le nom d’un événement, d’un client, d’une campagne. Il se change à tout moment."
          onSkip={() => setStep(1)}
        >
          <Input
            id="project-name"
            label="Nom du projet"
            autoFocus
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setStep(1);
            }}
          />
          <Button className="mt-6 w-full" variant="primary" size="lg" onClick={() => setStep(1)}>
            Continuer
          </Button>
        </Screen>
      )}

      {step === 1 && (
        <Screen
          title="Qu’allez-vous demander ?"
          hint="Cela règle le point de départ. Rien n’est verrouillé : tout se modifie ensuite."
          onBack={() => setStep(0)}
          onSkip={() => setStep(2)}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {KINDS.map((entry) => {
              const Icon = entry.icon;
              const active = kind === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => {
                    setKind(entry.id);
                    // Le choix d'un type suggère ses modules : un bon de
                    // commande sans tarification n'a jamais de sens, et laisser
                    // la personne le découvrir plus tard lui coûte un aller-
                    // retour dans les réglages.
                    setModules((previous) => ({
                      ...previous,
                      pricing: previous.pricing || entry.id === 'order' || entry.id === 'registration',
                      invoicing: previous.invoicing || entry.id === 'order',
                      email: previous.email || entry.id !== 'survey'
                    }));
                    setStep(2);
                  }}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors',
                    active
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:border-border-strong hover:bg-bg-elevated'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
                  <span className="text-sm font-medium text-text-primary">{entry.label}</span>
                </button>
              );
            })}
          </div>
        </Screen>
      )}

      {step === 2 && (
        <Screen
          title="Que doit savoir faire ce projet ?"
          hint="Chaque module ajoute un onglet. Ils s’allument et s’éteignent à tout moment."
          onBack={() => setStep(1)}
          onSkip={() => void begin(false)}
          skipLabel="Passer — je construis moi-même"
        >
          <div className="space-y-3">
            {MODULE_LABELS.map((entry) => (
              <div
                key={entry.key}
                className="flex items-start justify-between gap-4 rounded-xl border border-border px-4 py-3.5"
              >
                <div>
                  <p className="text-sm font-medium text-text-primary">{entry.label}</p>
                  <p className="mt-0.5 text-xs text-text-tertiary">{entry.hint}</p>
                </div>
                <Switch
                  checked={modules[entry.key]}
                  onChange={(checked) => setModules({ ...modules, [entry.key]: checked })}
                  label={entry.label}
                />
              </div>
            ))}
          </div>

          <Button
            className="mt-6 w-full"
            variant="primary"
            size="lg"
            loading={creating}
            iconLeft={<Sparkles className="h-4 w-4" />}
            onClick={() => void begin(true)}
          >
            Construire avec l’assistant
          </Button>
        </Screen>
      )}
    </div>
  );
}

function StepDots({ step }: { step: number }) {
  return (
    <div className="mt-6 flex gap-1.5" aria-hidden>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            'h-1 flex-1 rounded-full transition-colors',
            index <= step ? 'bg-accent' : 'bg-border'
          )}
        />
      ))}
    </div>
  );
}

function Screen({
  title,
  hint,
  children,
  onBack,
  onSkip,
  skipLabel = 'Passer'
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
  onBack?: () => void;
  onSkip: () => void;
  skipLabel?: string;
}) {
  return (
    <div className="mt-8">
      <h1 className="font-display text-2xl font-bold text-text-primary">{title}</h1>
      <p className="mt-2 text-sm text-text-secondary">{hint}</p>

      <div className="mt-7">{children}</div>

      <div className="mt-6 flex items-center justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs text-text-tertiary transition-colors hover:text-text-secondary"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Retour
          </button>
        ) : (
          <span />
        )}

        <button
          type="button"
          onClick={onSkip}
          className="text-xs text-text-tertiary underline-offset-4 transition-colors hover:text-text-secondary hover:underline"
        >
          {skipLabel}
        </button>
      </div>
    </div>
  );
}
