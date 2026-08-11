import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsSectionProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function SettingsSection({ icon: Icon, title, description, children, className }: SettingsSectionProps) {
  return (
    <div className={cn('space-y-4', className)}>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-mooove-navy" />}
          <h2 className="text-base font-display font-medium text-mooove-navy">
            {title}
          </h2>
        </div>
        {description && (
          <p className="text-sm text-text-secondary">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
