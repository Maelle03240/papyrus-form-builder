'use client';

import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { EmailTokenNode, markTokens } from './EmailTokenNode';
import { Bold, Italic, Link2, List, ListOrdered, Undo2 } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Éditeur riche du corps des e-mails.
 *
 * Il n'y a que six commandes, et c'est délibéré : un e-mail de confirmation
 * n'est pas une page. Ajouter titres, couleurs et tailles ferait produire des
 * messages qui s'affichent différemment dans chaque client de messagerie —
 * Outlook, Gmail et Apple Mail n'interprètent pas le même sous-ensemble de CSS.
 * Gras, italique, listes et liens passent partout.
 *
 * Le contenu est du HTML : c'est ce qui part dans le message. Les valeurs des
 * jetons `{{…}}` y sont échappées à l'envoi (`lib/email/tokens`), parce qu'elles
 * viennent du répondant et non de l'auteur.
 */

interface Props {
  value: string;
  onChange: (html: string) => void;
  /**
   * Change d'identité quand la langue change.
   *
   * TipTap garde son propre document : sans cette clé, basculer de « Français »
   * à « English » laisserait le texte français à l'écran, et la première frappe
   * l'écrirait dans le message anglais.
   */
  resetKey?: string;
  placeholder?: string;
  /** Rendu à droite de la barre d'outils — le sélecteur de jetons, en pratique. */
  toolbarExtra?: React.ReactNode;
  /** Reçoit l'éditeur pour permettre une insertion depuis l'extérieur. */
  onReady?: (insert: (token: string) => void) => void;
  /**
   * Jeton → libellé lisible.
   *
   * Les identifiants de champ sont des UUID : sans cette table, l'auteur écrit
   * « Bonjour {{ea92b44b-d0e7-…}}, » et ne peut plus dire quel jeton désigne
   * quoi. Le document, lui, garde bien l'identifiant.
   */
  tokenLabels?: Record<string, string>;
}

export function RichTextEditor({
  value,
  onChange,
  resetKey,
  placeholder,
  toolbarExtra,
  onReady,
  tokenLabels
}: Props) {
  const editor = useEditor(
    {
      // Next rend ce composant côté serveur avant de l'hydrater : sans ce
      // drapeau, TipTap produit deux arbres différents et React signale une
      // incohérence d'hydratation à chaque ouverture du panneau.
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false }),
        Link.configure({ openOnClick: false, autolink: true }),
        EmailTokenNode.configure({ labels: tokenLabels ?? {} })
      ],
      content: markTokens(value || ''),
      editorProps: {
        attributes: {
          class: 'prose-email min-h-[180px] px-3 py-2 outline-hidden',
          'aria-label': 'Corps du message'
        }
      },
      onUpdate: ({ editor: current }) => {
        const html = current.getHTML();
        // TipTap représente un document vide par un paragraphe vide. L'enregistrer
        // ferait passer un message non rédigé pour un message rédigé, et le
        // repli — celui qui porte le numéro de commande — ne partirait jamais.
        onChange(html === '<p></p>' ? '' : html);
      }
    },
    [resetKey]
  );

  useEffect(() => {
    if (!editor || !onReady) return;
    onReady((token: string) => {
      editor
        .chain()
        .focus()
        .insertContent({ type: 'emailToken', attrs: { token } })
        .run();
    });
  }, [editor, onReady]);

  const setLink = () => {
    if (!editor) return;
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Adresse du lien', previous ?? 'https://');
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  return (
    <div className="rounded-md border border-border-strong bg-bg-base focus-within:border-accent">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
        <ToolButton
          label="Gras"
          active={editor?.isActive('bold')}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          label="Italique"
          active={editor?.isActive('italic')}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          label="Liste à puces"
          active={editor?.isActive('bulletList')}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          label="Liste numérotée"
          active={editor?.isActive('orderedList')}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Lien" active={editor?.isActive('link')} onClick={setLink}>
          <Link2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Annuler" onClick={() => editor?.chain().focus().undo().run()}>
          <Undo2 className="h-3.5 w-3.5" />
        </ToolButton>

        {toolbarExtra && <div className="ml-auto">{toolbarExtra}</div>}
      </div>

      <div className="relative text-sm text-text-primary">
        {editor && editor.isEmpty && placeholder && (
          <p className="pointer-events-none absolute left-3 top-2 text-sm text-text-tertiary">
            {placeholder}
          </p>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function ToolButton({
  label,
  active,
  onClick,
  children
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? false}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-sm transition',
        active
          ? 'bg-accent/12 text-accent'
          : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}
