// Règle des mots de passe saisis dans TokenStudio (wallet rapide) : la même que celle du serveur.
export const PW_MIN = 10;
export const PW_RULES: { id: string; label: string; test: (p: string) => boolean }[] = [
  { id: 'len', label: PW_MIN + ' caractères minimum', test: (p) => p.length >= PW_MIN },
  { id: 'upper', label: 'Une majuscule', test: (p) => /\p{Lu}/u.test(p) },
  { id: 'lower', label: 'Une minuscule', test: (p) => /\p{Ll}/u.test(p) },
  { id: 'digit', label: 'Un chiffre', test: (p) => /\d/.test(p) },
  { id: 'symbol', label: 'Un symbole (! ? @ # $ % …)', test: (p) => /[^\p{L}\d\s]/u.test(p) },
];
// suites et mots trop courants, refusés même s'ils remplissent les règles (« Azerty123! »)
const WEAK = ['password', 'motdepasse', 'azerty', 'qwerty', '123456', 'abcdef', 'solana', 'phantom', 'tokenstudio', 'pumpfun', 'bitcoin', 'crypto', 'wallet', 'admin', 'letmein', 'bienvenue', 'welcome'];

/** Ce qui manque au mot de passe (vide : il est accepté) */
export function pwProblems(p: string): string[] {
  const out = PW_RULES.filter((r) => !r.test(p)).map((r) => r.label);
  const low = p.toLowerCase();
  if (WEAK.some((w) => low.includes(w))) out.push('Pas de mot trop courant (azerty, password, solana…)');
  if (/(.)\1{3,}/.test(p)) out.push('Pas plus de 3 caractères identiques à la suite');
  if (p.length > 200) out.push('200 caractères maximum');
  return out;
}

/** Force de 0 à 4 : règles respectées, longueur et variété */
export function pwScore(p: string): number {
  if (!p) return 0;
  const rules = PW_RULES.filter((r) => r.test(p)).length;
  let s = rules >= 5 ? 2 : rules >= 3 ? 1 : 0;
  // un mot de passe refusé ne dépasse jamais « Faible »
  if (pwProblems(p).length) return Math.min(1, s);
  if (p.length >= 14) s++;
  if (new Set(p).size >= 10) s++;
  return Math.min(4, s);
}
export const PW_LEVELS = ['Très faible', 'Faible', 'Correct', 'Fort', 'Très fort'];

/** Message d'erreur à afficher, ou null si le mot de passe est accepté */
export function pwError(p: string): string | null {
  const m = pwProblems(p);
  return m.length ? 'Mot de passe trop faible : ' + m.map((x) => x.toLowerCase()).join(', ') + '.' : null;
}

// accès pour le studio historique
(window as unknown as { TSPassword?: unknown }).TSPassword = { error: pwError };
