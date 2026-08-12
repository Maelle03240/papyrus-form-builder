/**
 * Enveloppe des pages intégrées.
 *
 * Le `body` du layout racine impose `min-h-screen` et une couleur de fond. Dans
 * une iframe, cela produit un bloc à la hauteur de l'écran du visiteur — la
 * hauteur remontée à la page hôte serait donc toujours celle de l'écran, quel
 * que soit le contenu — avec un fond opaque qui masque celui du site hôte.
 *
 * Le layout racine est le seul à pouvoir rendre `<body>` : on ne peut pas lui
 * retirer ces classes depuis ici. Cette feuille de style, rendue côté serveur
 * avec la page, les neutralise sans le clignotement qu'aurait provoqué une
 * manipulation du DOM au montage.
 */
const RESET = `
  body {
    min-height: 0 !important;
    background-color: transparent !important;
  }
`;

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: RESET }} />
      <div className="papyrus-embed-root w-full">{children}</div>
    </>
  );
}
