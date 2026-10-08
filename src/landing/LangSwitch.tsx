import { lang, setLang } from '../lib/i18n';

/** Bascule FR / EN des pages publiques */
export function LangSwitch() {
  const l = lang();
  return (
    <div className="lp-lang" role="group" aria-label={l === 'en' ? 'Language' : 'Langue'}>
      {(['fr', 'en'] as const).map((x) => (
        <button key={x} type="button" lang={x} aria-pressed={l === x} className={l === x ? 'on' : ''} onClick={() => { if (x !== l) setLang(x); }}
          aria-label={x === 'fr' ? 'Français' : 'English'}>{x.toUpperCase()}</button>
      ))}
    </div>
  );
}
