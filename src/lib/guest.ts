// Accès à l'outil sans compte : seulement en démo, ouverte depuis l'accueil (« Essayer la démo »).
// Sans compte et sans démo, /app renvoie vers l'accueil.
const KEY = 'ts_demo_guest';
const AUTH_KEY = 'tokenstudio-auth';

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
export const isDemoGuest = () => get(KEY) === '1';
export function enterDemoGuest() { try { localStorage.setItem(KEY, '1'); } catch { /* navigation privée */ } }
export function leaveDemoGuest() { try { localStorage.removeItem(KEY); } catch { /* navigation privée */ } }
/** Une session est peut-être enregistrée (vérifiée ensuite par Supabase) : évite d'afficher une page pour rien */
export const maybeSignedIn = () => !!get(AUTH_KEY);
/** Déconnexion en cours : l'outil laisse la redirection vers /connexion se faire (pas de renvoi vers l'accueil) */
let leaving = false;
export const markLeaving = () => { leaving = true; };
export const isLeaving = () => leaving;
