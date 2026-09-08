'use client';

import { useEffect, useRef, useState } from 'react';
import { Monitor, Smartphone, X, GitFork, Eye } from 'lucide-react';
import type { Form } from '@/types';
import { SaveResumeBar } from './SaveResumeBar';
import { FormPublicView } from '@/components/public/FormPublicView';
import { getBackgroundStyle } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { FormFlowView } from './FormFlowView';

/**
 * L'aperçu.
 *
 * Il montait autrefois ses propres vues — une copie de « tout sur une page »,
 * une de « une section par page », une de « une question à la fois », plus une
 * carte de champ et un rendu d'intitulé. Huit cents lignes qui devaient rester
 * identiques à celles de `components/public/`, et qui ne le sont pas restées :
 * l'aperçu évaluait la visibilité avec les seules règles de logique, quand la
 * vraie page y ajoutait les verrous portés par les champs et les sections. Un
 * formulaire pouvait donc s'afficher entier à l'auteur et masquer une question
 * au répondant, sans que rien ne le signale.
 *
 * Il monte maintenant **la vraie vue publique**, avec `preview` pour ne rien
 * envoyer. La question « est-ce que l'aperçu dit la vérité ? » ne se pose plus :
 * c'est le même composant, le même calcul de visibilité, le même rendu de
 * champ. Ce qui reste ici est ce que l'aperçu ajoute et que la page publique
 * n'a pas — le cadre téléphone, la vue du cheminement, et la sortie.
 */

interface Props {
  form: Form;
  onClose: () => void;
}

type Device = 'desktop' | 'mobile';

export function PreviewModal({ form, onClose }: Props) {
  const [device, setDevice] = useState<Device>('desktop');
  const [activeTab, setActiveTab] = useState<'preview' | 'flow'>('preview');
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Propage l'accent du formulaire à toute la modale via une variable CSS — les
  // classes Tailwind `text-accent`, `border-accent`, `bg-accent` la lisent.
  const accentStyle = { '--accent': form.theme.accent } as React.CSSProperties;

  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden isolate"
      style={{ background: 'var(--papyrus-bg)', ...accentStyle }}
    >
      <div className="relative z-100 w-full" style={{ boxSizing: 'border-box' }}>
        <PreviewToolbar
          form={form}
          device={device}
          setDevice={setDevice}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onClose={onClose}
        />
      </div>

      <div
        className="flex h-[calc(100%-3.5rem)] w-full flex-col relative z-0 min-h-0"
        style={{ transformOrigin: 'top center' }}
      >
        {activeTab === 'preview' && form.save_and_resume && (
          <SaveResumeBar formId={form.id} containerRef={contentRef} />
        )}

        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto"
          style={
            activeTab === 'preview'
              ? getBackgroundStyle(form.theme)
              : { backgroundColor: 'var(--bg-base)' }
          }
        >
          {activeTab === 'flow' ? (
            <FormFlowView form={form} />
          ) : (
            <div
              className={cn(
                'mx-auto w-full',
                // Le cadre téléphone est une largeur, et la vue reçoit en plus
                // `mobile` : les points de rupture CSS regardent la fenêtre,
                // pas ce cadre.
                device === 'mobile' && 'max-w-[390px] border-x border-border'
              )}
            >
              {/* La clé remonte la vue à chaque changement de cadre : l'essai
                  recommence, ce qui est ce qu'on veut en changeant d'appareil. */}
              <FormPublicView
                key={device}
                form={form}
                preview
                mobile={device === 'mobile'}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewToolbar({
  form,
  device,
  setDevice,
  activeTab,
  setActiveTab,
  onClose
}: {
  form: Form;
  device: Device;
  setDevice: (d: Device) => void;
  activeTab: 'preview' | 'flow';
  setActiveTab: (t: 'preview' | 'flow') => void;
  onClose: () => void;
}) {
  const mode = form.display_mode ?? 'sections';
  const _modeLabel =
    mode === 'sections' ? 'Pages' : mode === 'typeform' ? 'Une à une' : 'Défilement';

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '0 24px', minHeight: '3.5rem' }}>
      {/* GAUCHE — Onglets de vue */}
      <div style={{ flex: 1, display: 'flex', gap: '8px' }}>
        <button
          type="button"
          onClick={() => setActiveTab('preview')}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition',
            activeTab === 'preview'
              ? 'bg-bg-elevated border-border-strong text-text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          )}
        >
          <Eye size={14} /> Aperçu interactif
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('flow')}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition',
            activeTab === 'flow'
              ? 'bg-bg-elevated border-border-strong text-text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          )}
        >
          <GitFork size={14} /> Flux de logique
        </button>
      </div>

      {/* CENTRE */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        {activeTab === 'preview' && (
          <div className="flex items-center gap-0.5 rounded-md border border-border-strong bg-bg-base p-0.5">
            <DeviceButton active={device === 'desktop'} onClick={() => setDevice('desktop')}>
              <Monitor className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Desktop</span>
            </DeviceButton>
            <DeviceButton active={device === 'mobile'} onClick={() => setDevice('mobile')}>
              <Smartphone className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Mobile</span>
            </DeviceButton>
          </div>
        )}
      </div>

      {/* DROITE — flex:1 + flex-end pour coller à droite */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          style={{
            border: '1.5px solid #2AC2DE',
            color: '#052139',
            background: 'transparent',
            borderRadius: '8px',
            padding: '5px 14px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <X size={14} /> Échap
        </button>
      </div>
    </div>
  );
}

function DeviceButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition',
        active ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}
