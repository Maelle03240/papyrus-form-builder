'use client';

import { CreditCard } from 'lucide-react';

export default function BillingPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center space-y-6">
      {/* Icon with elegant background circle */}
      <div className="flex items-center justify-center w-24 h-24 rounded-full bg-bg-surface border border-border shadow-xs">
        <CreditCard className="w-12 h-12 text-text-tertiary" />
      </div>

      <div className="space-y-2 max-w-md">
        {/* Badge Pill */}
        <div className="inline-block px-3 py-1 text-[10px] font-semibold tracking-wide uppercase rounded-full bg-bg-surface border border-border text-text-secondary">
          Bientôt
        </div>
        
        {/* Title */}
        <h2 className="font-display text-3xl font-bold text-text-primary pt-2">
          Facturation
        </h2>
        
        {/* Explanatory text */}
        <p className="text-sm font-medium text-text-secondary">
          Cette section arrive bientôt.
        </p>
        
        <p className="text-xs text-text-tertiary leading-relaxed pt-1">
          Tu pourras bientôt gérer ton abonnement premium Papyrus, consulter tes factures et mettre à jour ton moyen de paiement en toute sécurité.
        </p>
      </div>
    </div>
  );
}
