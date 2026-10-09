import { useEffect, useRef, useState } from 'react';
import { lang, t } from '../lib/i18n';

/**
 * Case « Je ne suis pas un robot » (Cloudflare Turnstile, gratuit) sur la connexion et l'inscription.
 * Le jeton est vérifié par Supabase (connexion par e-mail ou par wallet) et par la fonction wallet-login.
 * Sans clé de site, la case n'apparaît pas et rien n'est demandé.
 */
// clé de site publique du widget TokenStudio (Cloudflare) ; VITE_TURNSTILE_SITE_KEY peut la remplacer, une valeur vide désactive la case
export const CAPTCHA_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '0x4AAAAAAFSLM0L7WevmEcS-';
export const captchaOn = () => !!CAPTCHA_SITE_KEY;

type Turnstile = {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile; } }

let loading: Promise<Turnstile> | null = null;
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (window.turnstile ? res(window.turnstile) : rej(new Error('turnstile')));
    s.onerror = () => { loading = null; rej(new Error('turnstile')); };
    document.head.appendChild(s);
  });
  return loading;
}

/* jeton courant, partagé avec les fonctions de connexion */
let token: string | null = null, widget: string | null = null;
const subs = new Set<(v: string | null) => void>();
const set = (v: string | null) => { token = v; subs.forEach((f) => f(v)); };

/** Jeton à joindre à une demande de connexion ; la case est remise à zéro, car un jeton ne sert qu'une fois */
export function takeCaptcha(): string | undefined {
  if (!captchaOn()) return undefined;
  const v = token ?? undefined;
  set(null);
  if (widget && window.turnstile) { try { window.turnstile.reset(widget); } catch { /* case retirée */ } }
  return v;
}
export function useCaptchaToken(): string | null {
  const [v, setV] = useState(token);
  useEffect(() => { subs.add(setV); setV(token); return () => { subs.delete(setV); }; }, []);
  return v;
}
export function captchaMissing(): string | null {
  return captchaOn() && !token ? t('Cochez d\'abord la case « Je ne suis pas un robot ».', 'First tick the “I am not a robot” box.') : null;
}

/** La case elle-même */
export function Captcha() {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!captchaOn() || !el.current) return;
    let id: string | null = null, alive = true;
    loadTurnstile().then((ts) => {
      if (!alive || !el.current) return;
      id = ts.render(el.current, {
        sitekey: CAPTCHA_SITE_KEY, theme: 'dark', size: 'flexible', appearance: 'always', language: lang(),
        callback: (v: string) => { setFailed(false); set(v); },
        'expired-callback': () => set(null),
        'error-callback': () => { set(null); setFailed(true); },
      });
      widget = id;
    }).catch(() => setFailed(true));
    return () => { alive = false; if (id && window.turnstile) { try { window.turnstile.remove(id); } catch { /* déjà retirée */ } } if (widget === id) widget = null; set(null); };
  }, []);
  if (!captchaOn()) return null;
  return (
    <div className="ts-captcha">
      <div ref={el} className="ts-captcha-box" />
      {failed && <p className="ts-captcha-err" role="alert">{t('La vérification anti-robot ne se charge pas. Désactivez votre bloqueur de contenu pour ce site, puis rechargez la page.', 'The anti-robot check didn\'t load. Disable your content blocker for this site, then reload the page.')}</p>}
    </div>
  );
}
