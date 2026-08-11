'use client';

import { useState, useEffect } from 'react';
import { Mail, Link as LinkIcon, Crown, User, Trash2, Copy, Check, X, Send, Edit2 } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmailAutocomplete, type EmailSuggestion } from '@/components/ui/EmailAutocomplete';
import { toast } from '@/components/ui/Toast';
import type { TeamMemberWithProfile, TeamInvitation, TeamRole } from '@/types';
import {
  getTeam,
  getTeamMembers,
  getTeamInvitations,
  createEmailInvitation,
  createLinkInvitation,
  deleteInvitation,
  removeMember,
  changeMemberRole,
  updateTeamName,
  isTeamAdmin
} from '@/lib/store/team-invitations';

export default function TeamSettingsPage() {
  const [members, setMembers] = useState<TeamMemberWithProfile[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentTeamId, setCurrentTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [editingTeamName, setEditingTeamName] = useState(false);
  const [savingTeamName, setSavingTeamName] = useState(false);

  // États pour les modales
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [emailToInvite, setEmailToInvite] = useState('');
  const [roleToInvite, setRoleToInvite] = useState<TeamRole>('member');
  const [generatedLink, setGeneratedLink] = useState<string>('');
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});

  // Créer les suggestions d'email à partir des membres existants
  const emailSuggestions: EmailSuggestion[] = members.map(member => ({
    email: member.email || '',
    name: member.name || undefined,
    isExisting: true
  })).filter(suggestion => suggestion.email); // Filtrer les emails vides

  // Charger les données
  useEffect(() => {
    getCurrentTeamAndLoadData();
  }, []);

  const getCurrentTeamAndLoadData = async () => {
    try {
      setLoading(true);

      // Récupérer l'ID de la team active depuis le cookie
      const getActiveTeamId = (): string | null => {
        if (typeof document === 'undefined') return null;
        const match = document.cookie.match(/(^|;)\s*papyrus:active-team-id\s*=\s*([^;]+)/);
        return match ? match[2] : null;
      };

      let teamId = getActiveTeamId();

      // Si pas de team active dans le cookie, récupérer la team principale de l'utilisateur
      if (!teamId) {
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          const { data: membership } = await supabase
            .from('team_members')
            .select('team_id')
            .eq('user_id', user.id)
            .eq('role', 'admin')
            .limit(1)
            .single();

          teamId = membership?.team_id || user.id;
        }
      }

      if (!teamId) {
        throw new Error('Aucune équipe trouvée');
      }

      setCurrentTeamId(teamId);
      await loadData(teamId);
    } catch (error) {
      console.error('Error loading team data:', error);
      toast.error('Impossible de charger les données de l\'équipe');
      setLoading(false);
    }
  };

  const loadData = async (teamId: string) => {
    try {
      const [membersData, invitationsData, adminStatus, teamData] = await Promise.all([
        getTeamMembers(teamId),
        getTeamInvitations(teamId),
        isTeamAdmin(teamId),
        getTeam(teamId)
      ]);

      setMembers(membersData);
      setInvitations(invitationsData);
      setIsAdmin(adminStatus);
      setTeamName(teamData.name);
    } catch (error) {
      console.error('Error loading team data:', error);
      toast.error('Impossible de charger les données de l\'équipe');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailInvitation = async () => {
    if (!emailToInvite.trim()) return;

    try {
      await createEmailInvitation(currentTeamId!, emailToInvite, roleToInvite);
      await loadData(currentTeamId!);
      setShowEmailModal(false);
      setEmailToInvite('');
      toast.success(`Une invitation a été envoyée à ${emailToInvite}`);
    } catch (error: any) {
      toast.error(error.message || 'Impossible d\'envoyer l\'invitation');
    }
  };

  const handleCreateLinkInvitation = async () => {
    try {
      const invitation = await createLinkInvitation(currentTeamId!, roleToInvite);
      const link = `${window.location.origin}/invite/${invitation.invite_token}`;
      setGeneratedLink(link);
      await loadData(currentTeamId!);
      toast.success('Le lien d\'invitation a été généré');
    } catch (error: any) {
      toast.error(error.message || 'Impossible de créer le lien');
    }
  };

  const handleCopyLink = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStates({ ...copiedStates, [id]: true });
      setTimeout(() => {
        setCopiedStates({ ...copiedStates, [id]: false });
      }, 2000);
      toast.success('Le lien a été copié dans le presse-papier');
    } catch {
      toast.error('Impossible de copier le lien');
    }
  };

  const handleDeleteInvitation = async (invitationId: string) => {
    try {
      await deleteInvitation(invitationId);
      await loadData(currentTeamId!);
      toast.success('L\'invitation a été annulée');
    } catch (error: any) {
      toast.error(error.message || 'Impossible de supprimer l\'invitation');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    try {
      await removeMember(currentTeamId!, userId);
      await loadData(currentTeamId!);
      toast.success('Le membre a été retiré de l\'équipe');
    } catch (error: any) {
      toast.error(error.message || 'Impossible de retirer le membre');
    }
  };

  const handleChangeRole = async (userId: string, newRole: TeamRole) => {
    try {
      await changeMemberRole(currentTeamId!, userId, newRole);
      await loadData(currentTeamId!);
      toast.success('Le rôle du membre a été mis à jour');
    } catch (error: any) {
      toast.error(error.message || 'Impossible de modifier le rôle');
    }
  };

  const handleSaveTeamName = async () => {
    if (!teamName.trim()) {
      toast.error('Le nom de l\'équipe ne peut pas être vide');
      return;
    }

    try {
      setSavingTeamName(true);
      await updateTeamName(currentTeamId!, teamName);
      setEditingTeamName(false);
      toast.success('Le nom de l\'équipe a été mis à jour');
    } catch (error: any) {
      toast.error(error.message || 'Impossible de mettre à jour le nom');
      setTeamName(teamName);
    } finally {
      setSavingTeamName(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-bg-overlay rounded w-48"></div>
        <div className="h-32 bg-bg-overlay rounded"></div>
        <div className="h-64 bg-bg-overlay rounded"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Infos de l'équipe */}
      <div className="space-y-4">
        <h2 className="text-xl font-display font-medium text-mooove-navy">Informations de l'équipe</h2>

        <div className="flex items-center justify-between p-4 border border-papyrus-border rounded-xl bg-papyrus-surface">
          <div className="flex-1">
            {editingTeamName ? (
              <div className="space-y-3">
                <Input
                  label="Nom de l'équipe"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="Nom de l'équipe"
                />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSaveTeamName}
                    disabled={savingTeamName}
                  >
                    {savingTeamName ? 'Sauvegarde...' : 'Sauvegarder'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditingTeamName(false)}
                  >
                    Annuler
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-sm text-text-secondary">Nom de l'équipe</p>
                <p className="text-lg font-medium text-text-primary">{teamName}</p>
              </div>
            )}
          </div>

          {isAdmin && !editingTeamName && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditingTeamName(true)}
              className="ml-4"
            >
              <Edit2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Header avec boutons d'invitation */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-display font-medium text-mooove-navy">
            Gestion de l'équipe
          </h2>

          {isAdmin && (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowEmailModal(true)}
                className="flex items-center gap-2"
              >
                <Mail className="w-4 h-4" />
                Par email
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowLinkModal(true)}
                className="flex items-center gap-2"
              >
                <LinkIcon className="w-4 h-4" />
                Par lien
              </Button>
            </div>
          )}
        </div>

        <p className="text-sm text-text-secondary">
          {members.length} membre{members.length > 1 ? 's' : ''} • {invitations.filter(inv => inv.status === 'pending').length} invitation{invitations.filter(inv => inv.status === 'pending').length > 1 ? 's' : ''} en attente
        </p>
      </div>

      {/* Membres actuels */}
      <div className="space-y-4">
        <h3 className="text-base font-medium text-mooove-navy">Membres</h3>

        <div className="space-y-3">
          {members.map((member) => (
            <div key={member.user_id} className="flex items-center justify-between p-4 border border-papyrus-border rounded-xl bg-papyrus-surface">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-mooove-navy rounded-full flex items-center justify-center text-white font-medium text-sm">
                  {member.name ? member.name[0].toUpperCase() : (member.email?.[0] || '?').toUpperCase()}
                </div>
                <div>
                  <div className="font-medium text-text-primary">
                    {member.name || 'Sans nom'}
                  </div>
                  <div className="text-sm text-text-secondary">{member.email || 'Email non disponible'}</div>
                </div>
                <Badge variant={member.role === 'admin' ? 'published' : 'neutral'}>
                  {member.role === 'admin' ? (
                    <><Crown className="w-3 h-3 mr-1" /> Admin</>
                  ) : (
                    <><User className="w-3 h-3 mr-1" /> Membre</>
                  )}
                </Badge>
              </div>

              {isAdmin && (
                <div className="flex items-center gap-2">
                  <select
                    value={member.role}
                    onChange={(e) => handleChangeRole(member.user_id, e.target.value as TeamRole)}
                    className="px-3 py-1 text-sm border border-papyrus-border rounded-lg bg-white"
                  >
                    <option value="member">Membre</option>
                    <option value="admin">Admin</option>
                  </select>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveMember(member.user_id)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Invitations en attente */}
      {invitations.filter(inv => inv.status === 'pending').length > 0 && (
        <div className="space-y-4">
          <h3 className="text-base font-medium text-mooove-navy">Invitations en attente</h3>

          <div className="space-y-3">
            {invitations.filter(inv => inv.status === 'pending').map((invitation) => (
              <div key={invitation.id} className="flex items-center justify-between p-4 border border-papyrus-border rounded-xl bg-amber-50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center text-white text-sm">
                    {invitation.invitation_type === 'email' ? (
                      <Mail className="w-5 h-5" />
                    ) : (
                      <LinkIcon className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-text-primary">
                      {invitation.invitation_type === 'email' ? invitation.email : 'Lien d\'invitation'}
                    </div>
                    <div className="text-sm text-text-secondary">
                      {invitation.invitation_type === 'email' ? 'Envoyée par email' : 'Invitation par lien'} •
                      Expire le {new Date(invitation.expires_at!).toLocaleDateString()}
                    </div>
                  </div>
                  <Badge variant="neutral">
                    {invitation.role === 'admin' ? 'Admin' : 'Membre'}
                  </Badge>
                </div>

                <div className="flex items-center gap-2">
                  {invitation.invitation_type === 'link' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyLink(
                        `${window.location.origin}/invite/${invitation.invite_token}`,
                        invitation.id
                      )}
                      className="flex items-center gap-2"
                    >
                      {copiedStates[invitation.id] ? (
                        <Check className="w-4 h-4 text-green-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  )}

                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteInvitation(invitation.id)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal invitation par email */}
      <Modal
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        title="Inviter par email"
      >
        <div className="space-y-4">
          <p className="text-text-secondary">
            Invitez un nouveau membre en saisissant son adresse email. Une invitation lui sera envoyée.
          </p>

          <div className="space-y-3">
            <EmailAutocomplete
              value={emailToInvite}
              onChange={setEmailToInvite}
              suggestions={emailSuggestions}
              placeholder="nom@exemple.com"
              label="Adresse email"
            />

            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Rôle
              </label>
              <select
                value={roleToInvite}
                onChange={(e) => setRoleToInvite(e.target.value as TeamRole)}
                className="w-full px-3 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="member">Membre</option>
                <option value="admin">Administrateur</option>
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowEmailModal(false)} className="flex-1">
              Annuler
            </Button>
            <Button variant="primary" onClick={handleEmailInvitation} className="flex-1 flex items-center gap-2">
              <Send className="w-4 h-4" />
              Envoyer l'invitation
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal invitation par lien */}
      <Modal
        isOpen={showLinkModal}
        onClose={() => setShowLinkModal(false)}
        title="Créer un lien d'invitation"
      >
        <div className="space-y-4">
          <p className="text-text-secondary">
            Créez un lien d'invitation que vous pourrez partager. Toute personne avec ce lien pourra rejoindre votre équipe.
          </p>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Rôle par défaut
            </label>
            <select
              value={roleToInvite}
              onChange={(e) => setRoleToInvite(e.target.value as TeamRole)}
              className="w-full px-3 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="member">Membre</option>
              <option value="admin">Administrateur</option>
            </select>
          </div>

          {generatedLink && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-primary">
                Lien d'invitation
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={generatedLink}
                  readOnly
                  className="flex-1 px-3 py-2 border border-border-strong rounded-lg bg-bg-elevated text-sm"
                />
                <Button
                  variant="secondary"
                  onClick={() => handleCopyLink(generatedLink, 'generated')}
                >
                  {copiedStates['generated'] ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-text-secondary">
                Ce lien expire dans 7 jours.
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button variant="secondary" onClick={() => {
              setShowLinkModal(false);
              setGeneratedLink('');
            }} className="flex-1">
              Fermer
            </Button>
            {!generatedLink && (
              <Button variant="primary" onClick={handleCreateLinkInvitation} className="flex-1">
                Générer le lien
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}