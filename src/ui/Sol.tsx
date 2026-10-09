/**
 * Montant en SOL avec son équivalent en dollars juste à côté.
 * Le dollar est ajouté par le studio (attribut data-usd, affiché par .sol::after) et suit le prix du SOL en direct.
 * stack : le dollar passe sous le montant (gros soldes).
 */
const fmt = (v: number, d?: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: d ?? (Math.abs(v) >= 10 ? 2 : 4), maximumFractionDigits: d ?? (Math.abs(v) >= 10 ? 2 : 4) });

export function Sol({ v, d, stack, unit = true, className = '' }: { v: number | null | undefined; d?: number; stack?: boolean; unit?: boolean; className?: string }) {
  if (v == null || !isFinite(v)) return <span className={className}>—</span>;
  return <span className={'sol' + (stack ? ' stack' : '') + (className ? ' ' + className : '')} data-sol={v}>{fmt(v, d)}{unit ? ' SOL' : ''}</span>;
}
