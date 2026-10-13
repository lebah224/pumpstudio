// Sans compte, /app renvoie vers l'accueil, sauf pour se connecter avec l'ancien wallet rapide du navigateur
// (?signin=quick depuis la page de connexion).
const AUTH_KEY = 'tokenstudio-auth';

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const quick = new URLSearchParams(location.search).get('signin') === 'quick';
/** Connexion avec l'ancien wallet rapide en cours : l'outil s'ouvre le temps de la connexion */
export const isQuickSignIn = () => quick;
/** Une session est peut-être enregistrée (vérifiée ensuite par Supabase) : évite d'afficher une page pour rien */
export const maybeSignedIn = () => !!get(AUTH_KEY);
/** Déconnexion en cours : l'outil laisse la redirection vers /connexion se faire (pas de renvoi vers l'accueil) */
let leaving = false;
export const markLeaving = () => { leaving = true; };
export const isLeaving = () => leaving;
