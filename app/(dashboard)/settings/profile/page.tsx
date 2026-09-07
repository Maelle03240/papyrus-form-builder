'use client';

import { useState, useEffect } from 'react';
import { Mail, Lock, Save, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import type {} from '@/types';
import {
  getUserProfile,
  updateUserProfile,
  changePassword,
  changeEmail
} from '@/lib/store/team-invitations';

export default function ProfileSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // États pour les formulaires
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');

  // États pour la modal de changement de mot de passe
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  });

  // États pour la modal de changement d'email
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const profileData = await getUserProfile();
      if (profileData) {
        setFirstName(profileData.first_name || '');
        setLastName(profileData.last_name || '');
        setEmail(profileData.email);
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      toast.error('Impossible de charger le profil');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    try {
      setSaving(true);
      await updateUserProfile({
        first_name: firstName || undefined,
        last_name: lastName || undefined
      });

      await loadProfile();
      toast.success('Vos informations ont été sauvegardées');
    } catch (error: any) {
      toast.error(error.message || 'Impossible de sauvegarder le profil');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error('Les mots de passe ne correspondent pas');
      return;
    }

    if (newPassword.length < 8) {
      toast.error('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }

    try {
      await changePassword(newPassword);
      setShowPasswordModal(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Votre mot de passe a été mis à jour');
    } catch (error: any) {
      toast.error(error.message || 'Impossible de modifier le mot de passe');
    }
  };

  const handleChangeEmail = async () => {
    if (!newEmail.includes('@')) {
      toast.error('Veuillez saisir une adresse email valide');
      return;
    }

    try {
      await changeEmail(newEmail);
      setShowEmailModal(false);
      setNewEmail('');
      setEmailPassword('');
      toast.success('Un email de confirmation a été envoyé à votre nouvelle adresse');
    } catch (error: any) {
      toast.error(error.message || 'Impossible de modifier l\'email');
    }
  };

  const togglePasswordVisibility = (field: 'current' | 'new' | 'confirm') => {
    setShowPasswords({
      ...showPasswords,
      [field]: !showPasswords[field]
    });
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-bg-overlay rounded-sm w-48"></div>
        <div className="h-32 bg-bg-overlay rounded-sm"></div>
        <div className="h-64 bg-bg-overlay rounded-sm"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Informations personnelles */}
      <div className="space-y-4">
        <h2 className="text-xl font-display font-medium text-mooove-navy">Informations personnelles</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Prénom"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Votre prénom"
          />

          <Input
            label="Nom"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Votre nom"
          />
        </div>

        <div className="flex justify-start">
          <Button
            variant="primary"
            onClick={handleSaveProfile}
            disabled={saving}
            className="flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Sauvegarde...' : 'Sauvegarder'}
          </Button>
        </div>
      </div>

      {/* Sécurité du compte */}
      <div className="space-y-4">
        <h2 className="text-xl font-display font-medium text-mooove-navy">Sécurité</h2>

        <div className="space-y-3">
          {/* Email */}
          <div className="flex items-center justify-between p-4 border border-papyrus-border rounded-xl bg-papyrus-surface">
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-text-secondary" />
              <div>
                <div className="font-medium text-text-primary">Adresse email</div>
                <div className="text-sm text-text-secondary">{email}</div>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowEmailModal(true)}
            >
              Modifier
            </Button>
          </div>

          {/* Mot de passe */}
          <div className="flex items-center justify-between p-4 border border-papyrus-border rounded-xl bg-papyrus-surface">
            <div className="flex items-center gap-3">
              <Lock className="w-5 h-5 text-text-secondary" />
              <div>
                <div className="font-medium text-text-primary">Mot de passe</div>
                <div className="text-sm text-text-secondary">Dernière modification il y a 30 jours</div>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowPasswordModal(true)}
            >
              Modifier
            </Button>
          </div>
        </div>
      </div>

      {/* Modal changement de mot de passe */}
      <Modal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        title="Changer le mot de passe"
      >
        <div className="space-y-4">
          <p className="text-text-secondary">
            Saisissez votre mot de passe actuel et votre nouveau mot de passe.
          </p>

          <div className="space-y-3">
            <div className="relative">
              <Input
                type={showPasswords.current ? "text" : "password"}
                placeholder="Mot de passe actuel"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                label="Mot de passe actuel"
              />
              <button
                type="button"
                onClick={() => togglePasswordVisibility('current')}
                className="absolute right-3 top-9 text-text-tertiary hover:text-text-secondary"
              >
                {showPasswords.current ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <div className="relative">
              <Input
                type={showPasswords.new ? "text" : "password"}
                placeholder="Nouveau mot de passe"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                label="Nouveau mot de passe"
              />
              <button
                type="button"
                onClick={() => togglePasswordVisibility('new')}
                className="absolute right-3 top-9 text-text-tertiary hover:text-text-secondary"
              >
                {showPasswords.new ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <div className="relative">
              <Input
                type={showPasswords.confirm ? "text" : "password"}
                placeholder="Confirmer le nouveau mot de passe"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                label="Confirmer le nouveau mot de passe"
              />
              <button
                type="button"
                onClick={() => togglePasswordVisibility('confirm')}
                className="absolute right-3 top-9 text-text-tertiary hover:text-text-secondary"
              >
                {showPasswords.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="text-xs text-text-secondary">
            Le mot de passe doit contenir au moins 8 caractères.
          </div>

          <div className="flex gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowPasswordModal(false)} className="flex-1">
              Annuler
            </Button>
            <Button
              variant="primary"
              onClick={handleChangePassword}
              className="flex-1"
              disabled={!currentPassword || !newPassword || !confirmPassword}
            >
              Changer le mot de passe
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal changement d'email */}
      <Modal
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        title="Changer l'adresse email"
      >
        <div className="space-y-4">
          <p className="text-text-secondary">
            Un email de confirmation sera envoyé à votre nouvelle adresse.
          </p>

          <div className="space-y-3">
            <Input
              type="email"
              placeholder="nouvelle@adresse.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              label="Nouvelle adresse email"
            />

            <Input
              type="password"
              placeholder="Mot de passe actuel"
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
              label="Mot de passe actuel"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowEmailModal(false)} className="flex-1">
              Annuler
            </Button>
            <Button
              variant="primary"
              onClick={handleChangeEmail}
              className="flex-1"
              disabled={!newEmail || !emailPassword}
            >
              Changer l'email
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}