// Formats des montants du Trader (français : virgule décimale, symbole après le nombre)
const nf = (v: number, min: number, max: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: min, maximumFractionDigits: max });
const SUB = '₀₁₂₃₄₅₆₇₈₉';

/** Prix d'un token : les très petits prix en notation compacte, 0,0₅2136 = 0,000002136 */
export function fPrice(v: number | null | undefined, unit = ''): string {
  if (v == null || !isFinite(v)) return '—';
  const sfx = unit ? ' ' + unit : '';
  const a = Math.abs(v);
  if (a === 0) return '0' + sfx;
  if (a >= 1000) return nf(v, 0, 0) + sfx;
  if (a >= 1) return nf(v, 2, 4) + sfx;
  if (a >= 0.001) return nf(v, 4, 6) + sfx;
  let zeros = Math.ceil(-Math.log10(a)) - 1;                  // zéros après la virgule
  if (Math.round(a * 10 ** (zeros + 4)) >= 1e4) zeros -= 1;    // arrondi qui passe à l'unité supérieure (0,0000099999)
  const digits = Math.round(a * 10 ** (zeros + 4)).toString().replace(/0+$/, '') || '0';
  return (v < 0 ? '−' : '') + '0,0' + String(zeros).split('').map((d) => SUB[+d]).join('') + digits.slice(0, 4) + sfx;
}
/** Montant compact : 12,3 k  ·  4,56 M  ·  1,2 Md */
export function fCompact(v: number | null | undefined, unit = '$'): string {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v), sfx = unit ? ' ' + unit : '';
  if (a >= 1e9) return nf(v / 1e9, 1, 2) + ' Md' + sfx;
  if (a >= 1e6) return nf(v / 1e6, 1, 2) + ' M' + sfx;
  if (a >= 1e3) return nf(v / 1e3, 1, 1) + ' k' + sfx;
  return nf(v, 0, a < 10 ? 2 : 0) + sfx;
}
export const fPct = (v: number | null | undefined, d = 1) => (v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), d, d) + ' %');
export const fNum = (v: number | null | undefined, d = 0) => (v == null || !isFinite(v) ? '—' : nf(v, 0, d));
export const fTok = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : fCompact(v, ''));
export const short = (a: string, n = 4) => (a ? a.slice(0, n) + '…' + a.slice(-n) : '');
/** Âge : 12 s, 4 min, 3 h, 5 j */
export function age(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return '—';
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return Math.floor(s) + ' s';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + ' h';
  if (s < 86400 * 365) return Math.floor(s / 86400) + ' j';
  return Math.floor(s / (86400 * 365)) + ' an' + (s >= 2 * 86400 * 365 ? 's' : '');
}
export const tone = (v: number | null | undefined) => (v == null || !isFinite(v) || v === 0 ? '' : v > 0 ? 'up' : 'down');
