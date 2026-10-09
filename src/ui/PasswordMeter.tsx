import { PW_LEVELS, PW_RULES, pwProblems, pwScore } from '../lib/password';

/** Jauge de force et liste des règles, mises à jour à chaque frappe */
export function PasswordMeter({ value, id }: { value: string; id?: string }) {
  const score = pwScore(value), extra = pwProblems(value).filter((m) => !PW_RULES.some((r) => r.label === m));
  return (
    <div className="ts-pwm" id={id} aria-live="polite">
      <div className="ts-pwm-bar" data-score={value ? score : -1} aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="ts-pwm-h"><span>Force du mot de passe</span><b data-score={value ? score : -1}>{value ? PW_LEVELS[score] : '—'}</b></div>
      <ul className="ts-pwm-rules">
        {PW_RULES.map((r) => { const ok = r.test(value); return <li key={r.id} className={ok ? 'ok' : ''}><span aria-hidden="true">{ok ? '✓' : '•'}</span>{r.label}<span className="sr-only">{ok ? ' : fait' : ' : manquant'}</span></li>; })}
        {value && extra.map((m) => <li key={m} className="bad"><span aria-hidden="true">✕</span>{m}</li>)}
      </ul>
    </div>
  );
}
