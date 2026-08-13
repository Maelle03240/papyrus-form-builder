'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { setActiveTeamId } from '@/lib/store';

interface Props {
  teamName?: string;
  userEmail?: string;
  activeTeam?: { id: string; name: string; plan: string };
  allTeams?: { id: string; name: string; plan: string }[];
  children: React.ReactNode;
}

export function DashboardWrapper({
  teamName,
  userEmail,
  activeTeam,
  allTeams,
  children
}: Props) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const pathname = usePathname();

  /**
   * Aligne le cookie sur l'espace que la coquille vient de résoudre.
   *
   * Le layout choisit l'espace actif (cookie, sinon premier espace de
   * l'utilisateur) mais ne pouvait pas l'écrire : un Server Component n'a pas le
   * droit de modifier les cookies. Le client et le serveur pouvaient donc être en
   * désaccord — soit parce que le cookie n'existait pas encore (compte neuf),
   * soit parce qu'il désignait un espace quitté depuis. Dans les deux cas, toute
   * création côté client visait un espace invalide et se faisait refuser par la
   * RLS.
   */
  useEffect(() => {
    if (activeTeam?.id) setActiveTeamId(activeTeam.id);
  }, [activeTeam?.id]);

  // Détecter si on est sur la page builder pour supprimer le padding
  const isBuilderPage = pathname.includes('/edit');

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        teamName={teamName}
        userEmail={userEmail}
        activeTeam={activeTeam}
        allTeams={allTeams}
        isCollapsed={isCollapsed}
        onToggle={() => setIsCollapsed(!isCollapsed)}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main
          className={`relative flex-1 ${isBuilderPage ? 'overflow-hidden' : 'overflow-y-auto'}`}
          style={{
            padding: isBuilderPage ? '0' : 'var(--layout-padding)'
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
