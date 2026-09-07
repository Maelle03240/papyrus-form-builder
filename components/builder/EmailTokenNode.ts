import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Un jeton `{{…}}` affiché comme une étiquette nommée.
 *
 * Sans lui, l'auteur écrit « Bonjour {{ea92b44b-d0e7-493f-9304-52d19696ee03}}, »
 * : les identifiants de champ Papyrus sont des UUID, et trois jetons dans un
 * paragraphe le rendent illisible — on ne peut même plus dire lequel désigne
 * quoi. L'étiquette montre le libellé de la question ; le document, lui, garde
 * l'identifiant.
 *
 * L'identifiant plutôt que le libellé dans ce qui est enregistré, et c'est le
 * point important : renommer une question ne doit pas casser en silence les
 * e-mails qui la citent.
 *
 * Le HTML produit est `<span data-email-token="…">{{…}}</span>`. Le `{{…}}`
 * textuel est ce qui compte : `renderTemplate` le remplace à l'envoi, sans rien
 * connaître de ce nœud. Un corps rédigé avant l'existence de cette étiquette —
 * ou collé depuis ailleurs — fonctionne donc exactement pareil.
 */

export interface EmailTokenOptions {
  /** Jeton → libellé lisible. Un jeton absent s'affiche tel quel. */
  labels: Record<string, string>;
}

export const EmailTokenNode = Node.create<EmailTokenOptions>({
  name: 'emailToken',
  inline: true,
  group: 'inline',
  // Insécable : un jeton se supprime d'un seul coup, comme le mot qu'il remplace.
  atom: true,
  selectable: true,

  addOptions() {
    return { labels: {} };
  },

  addAttributes() {
    return {
      token: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-email-token') ?? '',
        renderHTML: (attributes) => ({ 'data-email-token': attributes.token })
      }
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-email-token]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), `{{${node.attrs.token}}}`];
  },

  renderText({ node }) {
    return `{{${node.attrs.token}}}`;
  },

  addNodeView() {
    return ({ node, extension }) => {
      const token = String(node.attrs.token);
      const span = document.createElement('span');
      span.className = 'email-token';
      span.setAttribute('data-email-token', token);
      span.textContent = (extension.options as EmailTokenOptions).labels[token] ?? token;
      return { dom: span };
    };
  }
});

/**
 * Transforme les `{{jeton}}` textuels d'un corps enregistré en nœuds.
 *
 * TipTap ne reconnaît que des balises : sans cette conversion à la lecture, un
 * corps déjà en base s'afficherait avec ses UUID en clair, et l'étiquette ne
 * servirait qu'aux jetons insérés dans la session en cours.
 */
export function markTokens(html: string): string {
  if (!html) return html;
  return html.replace(
    /\{\{\s*([\w.-]+)\s*\}\}/g,
    (_match, token: string) => `<span data-email-token="${token}">{{${token}}}</span>`
  );
}
