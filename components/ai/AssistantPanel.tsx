'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  AudioLines,
  Check,
  FileUp,
  Loader2,
  Mic,
  Sparkles,
  Square,
  Undo2,
  X
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useDictation } from '@/lib/hooks/useDictation';
import { useVoiceSession } from '@/lib/hooks/useVoiceSession';
import { restoreFormVersion } from '@/lib/store';
import { cn } from '@/lib/utils';

/**
 * Le panneau de conversation.
 *
 * On décrit, on regarde construire, on annule si besoin. Les trois gestes sont
 * à l'écran en même temps — c'est ce qui distingue un assistant d'une boîte à
 * prompts : on voit ce qu'il fait pendant qu'il le fait, et le retour en
 * arrière est à portée de clic plutôt qu'à reconstruire à la main.
 *
 * Chaque outil exécuté s'affiche en clair, avec son résultat. Un assistant qui
 * dirait seulement « c'est fait » obligerait à relire tout le formulaire pour
 * savoir ce qui a changé.
 */

interface Props {
  teamId: string;
  projectId: string | null;
  formId: string | null;
  /** Rechargement du formulaire après un lot d'actions. */
  onChanged?: () => void;
  /** Fermeture du panneau. Absent = le panneau est la page entière. */
  onClose?: () => void;
  /** Premier message envoyé automatiquement — l'assistant de création s'en sert. */
  initialMessage?: string;
  /** Ce que l'assistant a créé, quand la conversation part de rien. */
  onCreated?: (ids: { project_id: string | null; form_id: string | null }) => void;
}

interface ToolTrace {
  name: string;
  ok: boolean;
  message: string;
}

interface Bubble {
  role: 'user' | 'assistant';
  content: string;
  tools?: ToolTrace[];
  /** Instantané pris avant le lot — permet d'annuler ce tour. */
  versionId?: string | null;
  error?: string;
}

/** Ce que les noms d'outils deviennent à l'écran. */
const TOOL_LABELS: Record<string, string> = {
  describe_project: 'Lecture du projet',
  describe_form: 'Lecture du formulaire',
  create_project: 'Création du projet',
  set_project_modules: 'Modules du projet',
  set_branding: 'Marque du projet',
  create_form: 'Création du formulaire',
  rename_form: 'Titre du formulaire',
  open_form: 'Ouverture du formulaire',
  add_section: 'Ajout d’une section',
  update_section: 'Modification d’une section',
  move_section: 'Déplacement d’une section',
  delete_section: 'Suppression d’une section',
  add_field: 'Ajout d’une question',
  update_field: 'Modification d’une question',
  set_options: 'Options d’une question',
  set_validation: 'Contraintes de saisie',
  set_visibility: 'Condition d’affichage',
  move_field: 'Déplacement d’une question',
  delete_field: 'Suppression d’une question',
  add_logic_rule: 'Règle de logique',
  delete_logic_rule: 'Suppression d’une règle',
  enable_pricing: 'Tarification',
  set_currency_vat: 'Devise et TVA',
  price_option: 'Prix des options',
  add_discount_code: 'Code de réduction',
  set_tiers: 'Tarif dégressif',
  set_email_default: 'E-mail de confirmation',
  add_email_rule: 'Message conditionnel',
  enable_partners: 'Programme partenaire',
  create_partner: 'Création d’un partenaire',
  link_partner_to_project: 'Lien de partage',
  connect_sheet: 'Feuille Google',
  map_columns: 'Répartition en onglets',
  publish_form: 'Publication'
};

export function AssistantPanel({
  teamId,
  projectId,
  formId,
  onChanged,
  onClose,
  initialMessage,
  onCreated
}: Props) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState({ projectId, formId });
  const [reading, setReading] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  /** Vrai tant que l'assistant est en train de parler dans la bulle en cours. */
  const speaking = useRef(false);

  /**
   * Deux voix, et une seule conversation à l'écran.
   *
   * La dictée écrit dans la zone de saisie : on relit avant d'envoyer. La
   * conversation en temps réel, elle, agit pendant qu'on parle — ses bulles
   * arrivent donc directement dans le fil, outils compris, exactement comme
   * celles de la conversation écrite. Rien ne distingue les deux à la lecture,
   * et c'est voulu : ce sont les mêmes outils, le même instantané, le même
   * bouton pour tout défaire.
   */
  const pushBubble = useCallback((bubble: Bubble) => {
    setBubbles((previous) => [...previous, bubble]);
  }, []);

  const patchOpenBubble = useCallback((patch: (bubble: Bubble) => Bubble) => {
    setBubbles((previous) => {
      const next = [...previous];
      const last = next[next.length - 1];
      if (!last || last.role !== 'assistant') {
        next.push(patch({ role: 'assistant', content: '', tools: [] }));
        return next;
      }
      next[next.length - 1] = patch(last);
      return next;
    });
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [bubbles]);

  const voice = useVoiceSession({
    teamId,
    projectId: anchor.projectId,
    formId: anchor.formId,
    handlers: {
      onUserText: (text) => {
        speaking.current = false;
        pushBubble({ role: 'user', content: text });
      },
      onAssistantDelta: (delta) => {
        if (!speaking.current) {
          speaking.current = true;
          pushBubble({ role: 'assistant', content: delta, tools: [] });
          return;
        }
        patchOpenBubble((bubble) => ({ ...bubble, content: bubble.content + delta }));
      },
      onAssistantDone: () => {
        speaking.current = false;
      },
      onTool: (trace) => {
        patchOpenBubble((bubble) => ({ ...bubble, tools: [...(bubble.tools ?? []), trace] }));
        onChanged?.();
      },
      onSnapshot: (versionId) => {
        patchOpenBubble((bubble) => ({ ...bubble, versionId }));
      },
      onAnchor: (ids) => {
        setAnchor({ projectId: ids.projectId, formId: ids.formId });
        onCreated?.({ project_id: ids.projectId, form_id: ids.formId });
      },
      onError: (message) => {
        toast.error(message);
      }
    }
  });

  const dictation = useDictation({
    teamId,
    // La dictée ne part pas toute seule : elle remplit la zone de saisie, et
    // c'est la personne qui envoie. Un mot mal entendu se corrige avant, pas
    // après — et « après », ici, veut dire vingt questions à défaire.
    onText: (text) => setDraft((previous) => (previous ? `${previous} ${text}` : text)),
    onError: (message) => toast.error(message)
  });

  const send = useCallback(
    async (message: string) => {
      if (!message.trim() || busy) return;

      setBusy(true);
      setDraft('');
      setBubbles((previous) => [
        ...previous,
        { role: 'user', content: message },
        { role: 'assistant', content: '', tools: [] }
      ]);

      /** Met à jour la dernière bulle — celle que l'assistant est en train d'écrire. */
      const patchLast = (patch: (bubble: Bubble) => Bubble) => {
        setBubbles((previous) => {
          const next = [...previous];
          next[next.length - 1] = patch(next[next.length - 1]);
          return next;
        });
      };

      let touchedForm = false;

      try {
        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            team_id: teamId,
            project_id: anchor.projectId,
            form_id: anchor.formId,
            conversation_id: conversationId
          })
        });

        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => null);
          patchLast((bubble) => ({
            ...bubble,
            error: body?.error ?? 'L’assistant est indisponible.'
          }));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Le flux arrive par paquets qui ne s'alignent pas sur les lignes : on
        // garde le reste en tampon plutôt que de tenter de parser un JSON coupé
        // en deux, ce qui perdrait un événement sur trois.
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data:')) continue;

            let event: Record<string, unknown>;
            try {
              event = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }

            if (event.type === 'text') {
              patchLast((bubble) => ({
                ...bubble,
                content: bubble.content + String(event.delta ?? '')
              }));
            } else if (event.type === 'tool') {
              touchedForm = true;
              patchLast((bubble) => ({
                ...bubble,
                tools: [
                  ...(bubble.tools ?? []),
                  {
                    name: String(event.name),
                    ok: event.ok === true,
                    message: String(event.message ?? '')
                  }
                ]
              }));
            } else if (event.type === 'snapshot') {
              patchLast((bubble) => ({ ...bubble, versionId: String(event.version_id) }));
            } else if (event.type === 'error') {
              patchLast((bubble) => ({ ...bubble, error: String(event.message) }));
            } else if (event.type === 'done') {
              if (event.conversation_id) setConversationId(String(event.conversation_id));

              const next = {
                projectId: (event.project_id as string | null) ?? anchor.projectId,
                formId: (event.form_id as string | null) ?? anchor.formId
              };
              setAnchor(next);

              if (next.projectId !== anchor.projectId || next.formId !== anchor.formId) {
                onCreated?.({ project_id: next.projectId, form_id: next.formId });
              }
            }
          }
        }
      } catch (error) {
        console.error('Conversation IA interrompue:', error);
        patchLast((bubble) => ({ ...bubble, error: 'La connexion a été perdue. Réessayez.' }));
      } finally {
        setBusy(false);
        if (touchedForm) onChanged?.();
      }
    },
    [anchor, busy, conversationId, onChanged, onCreated, teamId]
  );

  // Le message d'ouverture de l'assistant de création, envoyé une seule fois.
  useEffect(() => {
    if (initialMessage && !started.current) {
      started.current = true;
      void send(initialMessage);
    }
  }, [initialMessage, send]);

  async function undo(versionId: string) {
    if (!anchor.formId) return;
    try {
      await restoreFormVersion(anchor.formId, versionId);
      toast.success('Formulaire revenu à son état d’avant.');
      onChanged?.();
    } catch (error) {
      console.error('Restauration échouée:', error);
      toast.error('Le retour en arrière a échoué.');
    }
  }

  async function readDocument(file: File) {
    setReading(true);
    try {
      const body = new FormData();
      body.append('file', file);

      const response = await fetch('/api/ai/document', { method: 'POST', body });
      const data = await response.json().catch(() => null);

      if (!response.ok) throw new Error(data?.error ?? 'Le document n’a pas pu être lu.');

      if (data.truncated) {
        toast.warning(
          `Document tronqué : seuls les premiers ${data.text.length} caractères ont été retenus.`
        );
      }

      setDraft(
        `Voici un brouillon de formulaire (${data.filename}). Construis-le.\n\n${data.text}`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Le document n’a pas pu être lu.');
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <h2 className="font-display text-sm font-bold text-text-primary">Assistant</h2>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-bg-elevated hover:text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden />
            <span className="sr-only">Fermer l’assistant</span>
          </button>
        )}
      </header>

      {voice.status !== 'idle' && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 border-b border-accent/30 bg-accent/10 px-4 py-2.5"
        >
          <span className="flex items-center gap-2 text-xs font-medium text-text-primary">
            <AudioLines
              className={cn('h-4 w-4 text-accent', voice.status === 'live' && 'animate-pulse')}
              aria-hidden
            />
            {voice.status === 'live' ? 'En conversation — parlez.' : 'Connexion du micro…'}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void voice.stop()}>
            Raccrocher
          </Button>
        </div>
      )}

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {bubbles.length === 0 && <EmptyState onPick={(text) => void send(text)} />}

        {bubbles.map((bubble, index) => (
          <MessageBubble
            key={index}
            bubble={bubble}
            onUndo={bubble.versionId ? () => void undo(bubble.versionId as string) : undefined}
          />
        ))}

        {busy && (
          <p className="flex items-center gap-2 text-xs text-text-tertiary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            L’assistant travaille…
          </p>
        )}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-bg-base p-2 focus-within:border-border-strong">
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.txt,.md,.rtf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readDocument(file);
            }}
          />
          <button
            type="button"
            title="Partir d’un brouillon (PDF, DOCX, TXT)"
            disabled={busy || reading}
            onClick={() => fileInput.current?.click()}
            className="shrink-0 rounded-lg p-2 text-text-tertiary transition-colors hover:bg-bg-elevated hover:text-text-primary disabled:opacity-40"
          >
            {reading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <FileUp className="h-4 w-4" aria-hidden />
            )}
            <span className="sr-only">Joindre un brouillon</span>
          </button>

          <button
            type="button"
            title={dictation.status === 'recording' ? 'Arrêter la dictée' : 'Dicter'}
            disabled={busy || reading || dictation.status === 'transcribing'}
            onClick={() =>
              dictation.status === 'recording' ? dictation.stop() : void dictation.start()
            }
            className={cn(
              'shrink-0 rounded-lg p-2 transition-colors disabled:opacity-40',
              dictation.status === 'recording'
                ? 'bg-danger/10 text-danger'
                : 'text-text-tertiary hover:bg-bg-elevated hover:text-text-primary'
            )}
          >
            {dictation.status === 'transcribing' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : dictation.status === 'recording' ? (
              <Square className="h-4 w-4 fill-current" aria-hidden />
            ) : (
              <Mic className="h-4 w-4" aria-hidden />
            )}
            <span className="sr-only">
              {dictation.status === 'recording' ? 'Arrêter la dictée' : 'Dicter un message'}
            </span>
          </button>

          <button
            type="button"
            title="Conversation vocale"
            disabled={busy || voice.status === 'connecting'}
            onClick={() => (voice.status === 'idle' ? void voice.start() : void voice.stop())}
            className={cn(
              'shrink-0 rounded-lg p-2 transition-colors disabled:opacity-40',
              voice.status === 'idle'
                ? 'text-text-tertiary hover:bg-bg-elevated hover:text-text-primary'
                : 'bg-accent/15 text-accent'
            )}
          >
            <AudioLines className="h-4 w-4" aria-hidden />
            <span className="sr-only">
              {voice.status === 'idle' ? 'Ouvrir la conversation vocale' : 'Raccrocher'}
            </span>
          </button>

          <label className="sr-only" htmlFor="assistant-input">
            Votre message
          </label>
          <textarea
            id="assistant-input"
            rows={1}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Entrée envoie, Maj+Entrée passe à la ligne : la convention des
              // messageries, et celle que les doigts connaissent déjà.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
            placeholder="Décrivez le formulaire, ou demandez une modification."
            className="max-h-40 min-h-[2.25rem] flex-1 resize-none bg-transparent py-1.5 text-sm text-text-primary outline-hidden placeholder:text-text-tertiary"
          />

          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => void send(draft)}
            className="shrink-0 rounded-lg bg-mooove-navy p-2 text-mooove-ice transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
            <span className="sr-only">Envoyer</span>
          </button>
        </div>

        {dictation.status === 'recording' && (
          <p className="mt-2 flex items-center gap-2 text-xs text-text-tertiary" role="status">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden />
            Enregistrement — {formatSeconds(dictation.seconds)} sur{' '}
            {formatSeconds(dictation.maxSeconds)}. Le texte se relit avant d’être envoyé.
          </p>
        )}
      </div>
    </div>
  );
}

/** « 1:05 » plutôt que « 65 s » : c'est une durée, on la lit comme une durée. */
function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  /**
   * Trois exemples, pas une page d'aide.
   *
   * Ils montrent ce que l'assistant sait faire là où on ne l'attend pas —
   * la logique conditionnelle, les prix — plutôt que « crée un formulaire »,
   * que tout le monde devine déjà.
   */
  const examples = [
    'Un bulletin d’inscription à une course : identité, distance (5 km, 10 km, semi), taille de t-shirt, contact d’urgence.',
    'Ajoute une question « Avez-vous une allergie ? » et n’affiche « Laquelle ? » que si la réponse est oui.',
    'Mets 500 sur le 5 km, 800 sur le 10 km et 1 200 sur le semi, avec la TVA à 15 %.'
  ];

  return (
    <div className="py-6">
      <p className="text-sm text-text-secondary">
        Décrivez ce que vous voulez construire. L’assistant travaille par petits
        gestes — ajouter une question, poser une condition, fixer un prix — et
        chacun s’annule.
      </p>

      <ul className="mt-4 space-y-2">
        {examples.map((example) => (
          <li key={example}>
            <button
              type="button"
              onClick={() => onPick(example)}
              className="w-full rounded-lg border border-border px-3 py-2.5 text-left text-xs leading-relaxed text-text-secondary transition-colors hover:border-border-strong hover:bg-bg-elevated hover:text-text-primary"
            >
              {example}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessageBubble({ bubble, onUndo }: { bubble: Bubble; onUndo?: () => void }) {
  if (bubble.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-mooove-navy px-3.5 py-2.5 text-sm text-mooove-ice">
          {bubble.content}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {(bubble.tools ?? []).length > 0 && (
        <ul className="space-y-1">
          {(bubble.tools ?? []).map((tool, index) => (
            <li key={index} className="flex items-start gap-2 text-xs">
              {tool.ok ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
              )}
              <span className={cn(tool.ok ? 'text-text-secondary' : 'text-warning')}>
                {TOOL_LABELS[tool.name] ?? tool.name}
                {!tool.ok && ` — ${tool.message}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {bubble.content && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
          {bubble.content}
        </p>
      )}

      {bubble.error && (
        <p
          role="alert"
          className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          {bubble.error}
        </p>
      )}

      {onUndo && (
        <Button variant="ghost" size="sm" iconLeft={<Undo2 className="h-3.5 w-3.5" />} onClick={onUndo}>
          Annuler ces modifications
        </Button>
      )}
    </div>
  );
}
