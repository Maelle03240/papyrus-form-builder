/**
 * Remplaçant de `server-only` pour les tests.
 *
 * Le vrai module lève à l'import : c'est ce qui empêche un module serveur de
 * partir dans le bundle navigateur. La frontière reste garantie par le build de
 * Next ; ce fichier ne fait que rendre les modules serveur testables.
 */
export {};
