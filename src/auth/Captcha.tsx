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

/**
 * Vérification juste après le choix de connexion (wallet, e-mail, wallet rapide) :
 * une petite fenêtre « Vérification de sécurité » s'ouvre, Cloudflare valide en général tout seul en une seconde,
 * puis la connexion continue. Renvoie le jeton à joindre à la demande (une seule utilisation).
 */
export class HumanCancelled extends Error { constructor() { super('cancelled'); } }
type Gate = { resolve: (v: string | undefined) => void; reject: (e: Error) => void } | null;
let gate: Gate = null;
const gateSubs = new Set<(g: Gate) => void>();
const setGate = (g: Gate) => { gate = g; gateSubs.forEach((f) => f(g)); };
export function verifyHuman(): Promise<string | undefined> {
  if (!captchaOn()) return Promise.resolve(undefined);
  if (token) return Promise.resolve(takeCaptcha());
  gate?.reject(new HumanCancelled());
  return new Promise((resolve, reject) => setGate({ resolve, reject }));
}
const SHIELD = <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>;
/** Fenêtre de vérification, à placer une fois dans l'écran de connexion */
export function HumanGate() {
  const [g, setG] = useState<Gate>(gate);
  const v = useCaptchaToken();
  useEffect(() => { gateSubs.add(setG); return () => { gateSubs.delete(setG); }; }, []);
  // jeton reçu : la connexion reprend aussitôt
  useEffect(() => { if (g && v) { const r = g.resolve; setGate(null); r(takeCaptcha()); } }, [g, v]);
  useEffect(() => {
    if (!g) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { const r = g.reject; setGate(null); r(new HumanCancelled()); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [g]);
  if (!g) return null;
  const cancel = () => { const r = g.reject; setGate(null); r(new HumanCancelled()); };
  return (
    <div className="ts-modal ts-human" role="dialog" aria-modal="true" aria-labelledby="ts-human-t">
      <div className="ts-modal-box">
        <div className="ts-su-h"><span className="ts-su-ic">{SHIELD}</span><div><b id="ts-human-t">{t('Vérification de sécurité', 'Security check')}</b><span>{t('Nous vérifions que vous êtes bien une personne. Cela prend en général une seconde.', 'We check that you are a person. It usually takes a second.')}</span></div></div>
        <Captcha />
        <div className="ts-row ts-su-act"><button type="button" className="btn ghost" onClick={cancel}>{t('Annuler', 'Cancel')}</button></div>
      </div>
    </div>
  );
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
