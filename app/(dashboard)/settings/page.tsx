import { redirect } from 'next/navigation';

/**
 * `/settings` n'a pas de contenu propre.
 *
 * Cette page dupliquait intégralement la gestion des membres de
 * `/settings/team` — deux écrans à maintenir pour la même fonction, qui avaient
 * déjà divergé (rôles proposés différents, appels de store différents). Elle
 * renvoie désormais vers le premier onglet réel.
 */
export default function SettingsIndexPage() {
  redirect('/settings/profile');
}
