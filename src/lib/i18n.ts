// Langue des pages publiques (accueil, connexion, pages légales) : français ou anglais.
// L'outil (/app) reste en français : seules les pages publiques appellent initLang().
export type Lang = 'fr' | 'en';
const KEY = 'ts-lang';
let cur: Lang = 'fr';

/** Choix enregistré, sinon ?lang=, sinon langue du navigateur (français par défaut pour les francophones) */
export function initLang(): Lang {
  const q = new URLSearchParams(location.search).get('lang');
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* navigation privée */ }
  if (q === 'fr' || q === 'en') { cur = q; try { localStorage.setItem(KEY, q); } catch { /* navigation privée */ } }
  else if (saved === 'fr' || saved === 'en') cur = saved;
  else cur = (navigator.languages?.length ? navigator.languages : [navigator.language]).some((l) => /^fr\b/i.test(l)) ? 'fr' : 'en';
  document.documentElement.lang = cur;
  return cur;
}
export const lang = () => cur;
/** Texte dans la langue courante */
export const t = (fr: string, en: string) => (cur === 'en' ? en : fr);

/** Change de langue : choix retenu, page rechargée (sans ?lang=) */
export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* navigation privée */ }
  const u = new URL(location.href); u.searchParams.delete('lang');
  location.replace(u.pathname + u.search + u.hash);
}
