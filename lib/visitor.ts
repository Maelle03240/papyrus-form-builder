/**
 * Le cookie qui distingue deux visiteurs d'une page d'accueil partenaire.
 *
 * Sa seule valeur est un identifiant tiré au sort par le middleware : aucune
 * donnée personnelle, rien qui permette de reconnaître la personne ailleurs que
 * sur ces pages, et une durée de vie d'une demi-heure — la fenêtre de
 * dédoublonnage des visites, pas une de plus.
 *
 * C'est le remplaçant de l'adresse IP hachée. Papyrus a déjà tranché pour les
 * réponses : « sans sel configuré, on préfère ne rien stocker qu'un hachage
 * faible ». Une IP hachée avec un sel connu se retrouve de toute façon par force
 * brute, l'espace des adresses étant minuscule. Et derrière un partage de
 * connexion — un bureau, un hôtel, un opérateur mobile — une IP confond dix
 * visiteurs en un seul, là où un cookie les distingue.
 */
export const VISITOR_COOKIE = 'papyrus_visit';

/** Durée de vie, en secondes : la fenêtre de dédoublonnage des visites. */
export const VISITOR_COOKIE_MAX_AGE = 30 * 60;
