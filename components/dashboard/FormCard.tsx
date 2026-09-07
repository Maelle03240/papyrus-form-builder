'use client';

import { useState } from 'react';
import { MoreHorizontal, Edit2, Copy, Trash2, Download } from 'lucide-react';
import type { Form } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatRelativeTime } from '@/lib/utils';

interface FormCardProps {
  form: Form;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function FormCard({ form, onEdit, onDuplicate, onDelete }: FormCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handleCardClick = () => {
    onEdit(form.id);
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(!menuOpen);
  };

  const handleActionClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    setMenuOpen(false);
    action();
  };

  const handleDeleteConfirm = () => {
    onDelete(form.id);
    setShowDeleteModal(false);
  };

  const handleExportJson = () => {
    try {
      const cleanForm = { ...form };
      // Supprimer les champs de réponses et de statistiques pour ne garder que le design
      delete (cleanForm as any).responses_count;
      delete (cleanForm as any).completion_rate;
      
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cleanForm, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      const filename = `${(form.title || 'formulaire').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_export.json`;
      downloadAnchor.setAttribute("download", filename);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (error) {
      console.error('Failed to export JSON:', error);
      alert('Une erreur est survenue lors de l\'exportation');
    }
  };

  return (
    <>
      <div
        onClick={handleCardClick}
        className="group relative flex flex-col justify-between p-6 h-48 cursor-pointer transition-all duration-200 border bg-bg-surface border-border hover:border-border-strong rounded-2xl shadow-xs hover:shadow-md"
      >
        {/* Top bar with Badge and Options Menu */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Badge variant={form.status}>
              {form.status === 'published' ? 'Publié' : form.status === 'closed' ? 'Clos' : 'Brouillon'}
            </Badge>
            {form.closes_at && (
              <Badge variant="neutral" className="flex items-center gap-1.5 border-dashed text-xs py-0.5 px-2 font-normal">
                <span className={`h-1.5 w-1.5 rounded-full ${new Date(form.closes_at) > new Date() ? 'bg-orange-500' : 'bg-red-500'}`} />
                {new Date(form.closes_at) > new Date() ? 'Date de fin' : 'Fermé (date)'}
              </Badge>
            )}
          </div>

          {/* Options button */}
          <div className="relative">
            <button
              onClick={handleMenuClick}
              className="p-1.5 rounded-lg border border-transparent hover:border-border hover:bg-bg-elevated text-text-tertiary hover:text-text-primary transition"
              aria-label="Options du formulaire"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {/* Dropdown menu */}
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                  }}
                />
                <div className="absolute right-0 mt-1 w-44 rounded-xl border border-border bg-bg-surface py-1 shadow-lg z-40 animate-in fade-in slide-in-from-top-1 duration-100">
                  <button
                    onClick={(e) => handleActionClick(e, () => onEdit(form.id))}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition"
                  >
                    <Edit2 className="h-5 w-5" />
                    Modifier
                  </button>
                  <button
                    onClick={(e) => handleActionClick(e, () => onDuplicate(form.id))}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition"
                  >
                    <Copy className="h-5 w-5" />
                    Dupliquer
                  </button>
                  <button
                    onClick={(e) => handleActionClick(e, handleExportJson)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition"
                  >
                    <Download className="h-5 w-5" />
                    Exporter (JSON)
                  </button>
                  <div className="my-1 border-t border-border" />
                  <button
                    onClick={(e) => handleActionClick(e, () => setShowDeleteModal(true))}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger/5 transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Supprimer
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Title */}
        <div className="mt-4 flex-1">
          <h4 className="font-display text-xl font-bold text-text-primary line-clamp-2 leading-snug group-hover:text-accent transition-colors">
            {form.title || 'Formulaire sans titre'}
          </h4>
          {form.description && (
            <p className="text-xs text-text-tertiary mt-1 line-clamp-1">
              {form.description}
            </p>
          )}
        </div>

        {/* Footer info */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-dashed border-border text-base text-text-tertiary">
          <span>Modifié {formatRelativeTime(form.updated_at)}</span>
          {form.fields && (
            <span>
              {form.fields.length} question{form.fields.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Supprimer le formulaire"
      >
        <div className="space-y-4">
          <p>
            Êtes-vous sûr de vouloir supprimer définitivement le formulaire{' '}
            <strong className="text-text-primary">« {form.title} »</strong> ?
          </p>
          <p className="text-xs text-text-tertiary">
            Cette action est irréversible. Toutes les questions, configurations et réponses associées seront définitivement perdues.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowDeleteModal(false)}
            >
              Annuler
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteConfirm}
            >
              Supprimer définitivement
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
