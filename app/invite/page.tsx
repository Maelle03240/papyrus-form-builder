'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Users, Mail, CheckCircle, XCircle, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { createClient } from '@/lib/supabase/client';
import type { TeamInvitation } from '@/types';
import { acceptInvitation } from '@/lib/store/team-invitations';

function InviteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const invitationId = searchParams.get('id');

  const [invitation, setInvitation] = useState<TeamInvitation | null>(null);
  const [teamName, setTeamName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string>('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    checkAuthAndLoadInvitation();
  }, [invitationId]);

  const checkAuthAndLoadInvitation = async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setIsAuthenticated(!!user);

      if (!invitationId) {
        setError('Lien d\'invitation invalide');
        setLoading(false);
        return;
      }

      // Charger l'invitation
      const { data: invitationData, error: invitationError } = await supabase
        .from('team_invitations')
        .select(`
          *,
          teams (
            name
          )
        `)
        .eq('id', invitationId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .single();

      if (invitationError || !invitationData) {
        setError('Cette invitation n\'existe pas ou a expiré');
        setLoading(false);
        return;
      }

      setInvitation(invitationData);
      setTeamName(invitationData.teams?.name || 'Une équipe');
    } catch (err) {
      console.error('Error loading invitation:', err);
      setError('Une erreur s\'est produite lors du chargement de l\'invitation');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptInvitation = async () => {
    if (!invitation) return;

    try {
      setAccepting(true);
      const result = await acceptInvitation(invitation.id);

      if (result.success) {
        setAccepted(true);
        toast.success(`Vous avez rejoint l'équipe ${teamName}`);

        // Rediriger vers le dashboard après 2 secondes
        setTimeout(() => {
          router.push('/dashboard');
        }, 2000);
      } else {
        setError(result.error || 'Impossible d\'accepter l\'invitation');
      }
    } catch (err: any) {
      setError(err.message || 'Une erreur s\'est produite');
    } finally {
      setAccepting(false);
    }
  };

  const handleLogin = () => {
    // Sauvegarder l'URL d'invitation pour rediriger après la connexion
    sessionStorage.setItem('redirect_after_login', window.location.href);
    router.push('/login');
  };

  const handleSignup = () => {
    // Sauvegarder l'URL d'invitation pour rediriger après l'inscription
    sessionStorage.setItem('redirect_after_signup', window.location.href);
    router.push('/signup');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-var(--papyrus-bg) flex items-center justify-center">
        <div className="max-w-md mx-auto p-8 bg-var(--papyrus-surface) rounded-2xl border border-var(--papyrus-border) shadow-lg text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-var(--mooove-navy)" />
          <p className="text-text-secondary">Chargement de l'invitation...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-var(--papyrus-bg) flex items-center justify-center">
        <div className="max-w-md mx-auto p-8 bg-var(--papyrus-surface) rounded-2xl border border-var(--papyrus-border) shadow-lg text-center">
          <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-display font-medium text-var(--mooove-navy) mb-2">
            Invitation invalide
          </h1>
          <p className="text-text-secondary mb-6">{error}</p>
          <Button
            variant="primary"
            onClick={() => router.push('/dashboard')}
            className="w-full"
          >
            Retour au dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen bg-var(--papyrus-bg) flex items-center justify-center">
        <div className="max-w-md mx-auto p-8 bg-var(--papyrus-surface) rounded-2xl border border-var(--papyrus-border) shadow-lg text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-display font-medium text-var(--mooove-navy) mb-2">
            Invitation acceptée !
          </h1>
          <p className="text-text-secondary mb-6">
            Vous avez rejoint l'équipe <strong>{teamName}</strong>.
          </p>
          <div className="flex items-center justify-center text-sm text-text-secondary">
            <span>Redirection en cours...</span>
            <ArrowRight className="w-4 h-4 ml-2" />
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-var(--papyrus-bg) flex items-center justify-center">
        <div className="max-w-md mx-auto p-8 bg-var(--papyrus-surface) rounded-2xl border border-var(--papyrus-border) shadow-lg">
          <div className="text-center mb-6">
            <Users className="w-12 h-12 text-var(--mooove-navy) mx-auto mb-4" />
            <h1 className="text-xl font-display font-medium text-var(--mooove-navy) mb-2">
              Invitation à rejoindre une équipe
            </h1>
            <p className="text-text-secondary">
              Vous avez été invité à rejoindre l'équipe <strong>{teamName}</strong> sur Papyrus.
            </p>
          </div>

          <div className="space-y-3">
            <Button
              variant="primary"
              onClick={handleLogin}
              className="w-full"
            >
              Se connecter pour accepter
            </Button>
            <Button
              variant="secondary"
              onClick={handleSignup}
              className="w-full"
            >
              Créer un compte
            </Button>
          </div>

          <div className="text-center mt-6">
            <p className="text-xs text-text-secondary">
              En acceptant cette invitation, vous pourrez collaborer avec l'équipe {teamName}.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-var(--papyrus-bg) flex items-center justify-center">
      <div className="max-w-md mx-auto p-8 bg-var(--papyrus-surface) rounded-2xl border border-var(--papyrus-border) shadow-lg">
        <div className="text-center mb-6">
          <Users className="w-12 h-12 text-var(--mooove-navy) mx-auto mb-4" />
          <h1 className="text-xl font-display font-medium text-var(--mooove-navy) mb-2">
            Invitation à rejoindre une équipe
          </h1>
          <p className="text-text-secondary mb-4">
            Vous avez été invité à rejoindre l'équipe <strong>{teamName}</strong> sur Papyrus.
          </p>

          {invitation && (
            <div className="flex items-center justify-center gap-2 mb-4">
              <Badge variant={invitation.role === 'admin' ? 'published' : 'neutral'}>
                {invitation.role === 'admin' ? 'Administrateur' : 'Membre'}
              </Badge>
              <Badge variant="neutral">
                <Mail className="w-3 h-3 mr-1" />
                {invitation.invitation_type === 'email' ? 'Par email' : 'Par lien'}
              </Badge>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-medium text-blue-900 mb-1">En acceptant cette invitation :</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Vous pourrez accéder aux formulaires de l'équipe</li>
              <li>• Vous pourrez collaborer avec les autres membres</li>
              <li>• Vous recevrez les notifications de l'équipe</li>
            </ul>
          </div>

          <Button
            variant="primary"
            onClick={handleAcceptInvitation}
            disabled={accepting}
            className="w-full flex items-center justify-center gap-2"
          >
            {accepting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Acceptation en cours...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                Accepter l'invitation
              </>
            )}
          </Button>

          <Button
            variant="secondary"
            onClick={() => router.push('/dashboard')}
            className="w-full"
          >
            Peut-être plus tard
          </Button>
        </div>

        {invitation?.expires_at && (
          <div className="text-center mt-6">
            <p className="text-xs text-text-secondary">
              Cette invitation expire le {new Date(invitation.expires_at).toLocaleDateString('fr-FR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-var(--papyrus-bg) flex items-center justify-center">
      <div className="max-w-md mx-auto p-8 bg-var(--papyrus-surface) rounded-2xl border border-var(--papyrus-border) shadow-lg text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-var(--mooove-navy)" />
        <p className="text-text-secondary">Chargement...</p>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <InviteContent />
    </Suspense>
  );
}