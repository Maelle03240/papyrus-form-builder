'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings, Users, User, Plug, ShieldCheck, Sparkles } from 'lucide-react';
import { SettingsHeader } from '@/components/ui/SettingsHeader';
import { cn } from '@/lib/utils';

/**
 * Navigation des paramètres.
 *
 * Les entrées « Apparence » et « Notifications » pointaient vers des pages qui
 * n'existent pas : elles menaient à un 404. Elles sont remplacées par les deux
 * écrans réellement implémentés.
 */
const SETTINGS_NAVIGATION = [
  {
    label: 'Profil',
    href: '/settings/profile',
    icon: User,
    description: 'Vos informations personnelles'
  },
  {
    label: 'Équipe',
    href: '/settings/team',
    icon: Users,
    description: 'Membres et invitations'
  },
  {
    label: 'Assistant',
    href: '/settings/assistant',
    icon: Sparkles,
    description: 'Clé, modèle et budget de l’IA'
  },
  {
    label: 'Intégrations',
    href: '/settings/integrations',
    icon: Plug,
    description: 'Importer depuis Tally'
  },
  {
    label: 'Accès',
    href: '/settings/access',
    icon: ShieldCheck,
    description: 'Domaines autorisés à rejoindre'
  }
];

interface Props {
  children: React.ReactNode;
}

export default function SettingsLayout({ children }: Props) {
  const pathname = usePathname();

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <SettingsHeader
        icon={Settings}
        title="Paramètres"
        description="Gérez votre compte, votre équipe et vos préférences."
      />

      <div className="flex gap-6">
        {/* Sidebar navigation */}
        <div className="w-56 shrink-0">
          <nav className="space-y-2">
            {SETTINGS_NAVIGATION.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex flex-col rounded-xl px-4 py-3 text-left transition-all',
                    isActive
                      ? 'bg-mooove-navy text-white shadow-xs'
                      : 'text-text-primary hover:bg-bg-elevated'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      className={cn(
                        'h-5 w-5 shrink-0 transition-colors',
                        isActive ? 'text-mooove-cyan' : 'text-text-secondary'
                      )}
                    />
                    <span className="text-base font-medium">{item.label}</span>
                  </div>
                  <p
                    className={cn(
                      'ml-8 mt-1 text-xs',
                      isActive ? 'text-white/70' : 'text-text-tertiary'
                    )}
                  >
                    {item.description}
                  </p>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="bg-papyrus-surface rounded-2xl border border-papyrus-border p-8">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}