import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsHeaderProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

export function SettingsHeader({ icon: Icon, title, description, className }: SettingsHeaderProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-3">
        <Icon className="w-6 h-6 text-mooove-navy" />
        <h1 className="text-xl font-display font-semibold text-mooove-navy">
          {title}
        </h1>
      </div>
      {description && (
        <p className="text-sm text-text-secondary">
          {description}
        </p>
      )}
    </div>
  );
}
