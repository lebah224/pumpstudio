// Outils de sécurité communs aux fonctions Edge : CORS, limites d'appels, confirmation renforcée,
// vérification anti-robot (Cloudflare Turnstile), règle des mots de passe et e-mails d'alerte (Brevo).
import { createClient, type User } from 'npm:@supabase/supabase-js@2.117.3';

export const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

/* ---------- CORS ---------- */
const HOSTS = [
  /^tokenstudio-sol\.vercel\.app$/,
  /^pumpstudio\.vercel\.app$/,
  /^tokenstudio(-git)?-[a-z0-9-]+-sadou-9f22dc7f\.vercel\.app$/,
  /^localhost(:\d{2,5})?$/,
  /^127\.0\.0\.1(:\d{2,5})?$/,
];
export const allowedHost = (h: string) => HOSTS.some((re) => re.test(h));
export function cors(origin: string | null): Record<string, string> {
  let ok = false;
  try { ok = !!origin && allowedHost(new URL(origin).host); } catch { ok = false; }
  return {
    'Access-Control-Allow-Origin': ok && origin ? origin : 'https://tokenstudio-sol.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
export const json = (status: number, body: unknown, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export class Fail extends Error {
  constructor(public status: number, msg: string, public extra: Record<string, unknown> = {}) { super(msg); }
}

/* ---------- requête ---------- */
export const clientIp = (req: Request) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || req.headers.get('cf-connecting-ip') || '';
export function claims(req: Request): Record<string, unknown> {
  try {
    const t = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
    return JSON.parse(atob(t.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return {}; }
}
export async function requireUser(req: Request): Promise<User> {
  const { data: { user } } = await admin.auth.getUser((req.headers.get('Authorization') ?? '').replace(/^Bearer /, ''));
  if (!user) throw new Fail(401, 'Connexion requise.');
  return user;
}

/* ---------- limites d'appels (compteur en base, fenêtre fixe) ---------- */
export async function rate(key: string, max: number, windowSec: number, msg = 'Trop de demandes : réessayez dans quelques minutes.') {
  const { data, error } = await admin.rpc('sec_rate', { p_key: key, p_max: max, p_window: windowSec });
  if (error) return; // compteur indisponible : on ne bloque pas le service
  if (data === false) throw new Fail(429, msg);
}

/* ---------- confirmation renforcée ---------- */
export const STEP_UP_PURPOSES = ['withdraw', 'limits_up', 'export_key', 'delete_wallet', 'link_wallet', 'delete_account'] as const;
export type StepUpPurpose = typeof STEP_UP_PURPOSES[number];
export const mailReady = () => !!(Deno.env.get('BREVO_API_KEY') && Deno.env.get('BREVO_SENDER'));
/** Consomme l'autorisation obtenue par code (e-mail ou 2FA) ; sinon 428 : le navigateur demande la confirmation puis recommence */
export async function requireStepUp(uid: string, purpose: StepUpPurpose) {
  // tant que l'envoi d'e-mails du serveur n'est pas configuré, le code ne peut pas partir : la confirmation n'est pas
  // exigée, sinon les comptes sans double authentification seraient bloqués (retrait, suppression…)
  if (!mailReady()) return;
  const { data, error } = await admin.rpc('sec_grant_consume', { uid, p_purpose: purpose });
  if (error) throw new Fail(500, 'Vérification de sécurité indisponible.');
  if (!data) throw new Fail(428, 'Confirmez cette action avec le code de sécurité.', { code: 'step_up', purpose });
}

/* ---------- case anti-robot (Turnstile) : vérifiée seulement si la clé secrète est configurée ---------- */
export async function verifyCaptcha(token: unknown, ip: string): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET');
  if (!secret) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const f = new FormData(); f.append('secret', secret); f.append('response', token); if (ip) f.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: f, signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    return j.success === true;
  } catch { return false; }
}

/* ---------- mots de passe (même règle que le navigateur : src/lib/password.ts) ---------- */
const WEAK = ['password', 'motdepasse', 'azerty', 'qwerty', '123456', 'abcdef', 'solana', 'phantom', 'tokenstudio', 'pumpfun', 'bitcoin', 'crypto', 'wallet', 'admin', 'letmein', 'bienvenue', 'welcome'];
export function passwordError(p: unknown): string | null {
  if (typeof p !== 'string') return 'Mot de passe manquant.';
  const miss: string[] = [];
  if (p.length < 10) miss.push('10 caractères minimum');
  if (!/\p{Lu}/u.test(p)) miss.push('une majuscule');
  if (!/\p{Ll}/u.test(p)) miss.push('une minuscule');
  if (!/\d/.test(p)) miss.push('un chiffre');
  if (!/[^\p{L}\d\s]/u.test(p)) miss.push('un symbole');
  if (WEAK.some((w) => p.toLowerCase().includes(w))) miss.push('pas de mot trop courant');
  if (/(.)\1{3,}/.test(p)) miss.push('pas plus de 3 caractères identiques à la suite');
  if (p.length > 200) miss.push('200 caractères maximum');
  return miss.length ? 'Mot de passe trop faible : ' + miss.join(', ') + '.' : null;
}

/* ---------- e-mails (API Brevo) ---------- */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const userLang = (u: User): 'fr' | 'en' => (u.user_metadata?.lang === 'en' ? 'en' : 'fr');
export const maskEmail = (e: string) => { const [a, d] = e.split('@'); return (a!.length <= 2 ? a![0] + '•' : a!.slice(0, 2) + '•'.repeat(Math.min(6, a!.length - 2))) + '@' + d; };

type Mail = { title: string; lead: string; code?: string; rows?: [string, string][]; foot?: string };
function layout(lang: 'fr' | 'en', m: Mail, anti: string | null) {
  const L = lang === 'en';
  const rows = (m.rows ?? []).map(([k, v]) => `<tr><td style="padding:6px 0;color:#6b6457;font-size:13px;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#1b1407;font-size:14px;word-break:break-all">${esc(v)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #e6dfd1;border-radius:16px">
<tr><td style="padding:24px 28px 0;font-size:19px;font-weight:700;color:#1b1407">Token<span style="color:#a8823c">Studio</span></td></tr>
${anti ? `<tr><td style="padding:14px 28px 0"><div style="padding:10px 12px;border-radius:10px;background:#f6efe0;border:1px solid #e6d3a8;font-size:13px;color:#5a3d12">${L ? 'Your anti-phishing code' : 'Votre code anti-hameçonnage'} : <b>${esc(anti)}</b></div></td></tr>` : ''}
<tr><td style="padding:20px 28px 28px">
<h1 style="margin:0 0 12px;font-size:21px;line-height:1.3;color:#1b1407">${esc(m.title)}</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#3d382f">${m.lead}</p>
${m.code ? `<p style="margin:22px 0 4px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#8b8375">${L ? 'Your code' : 'Votre code'}</p><p style="margin:0;font:600 32px/1.2 'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:6px;color:#1b1407">${esc(m.code)}</p>` : ''}
${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid #eee6d6">${rows}</table>` : ''}
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b6457">${m.foot ?? (L ? 'If this wasn\'t you, sign in now, disconnect all your devices (Security tab) and contact us.' : 'Si ce n\'est pas vous, connectez-vous tout de suite, déconnectez tous vos appareils (onglet Sécurité) et prévenez-nous.')}</p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#8b8375">TokenStudio · ${L ? 'security message, sent automatically' : 'message de sécurité, envoyé automatiquement'}</p>
</td></tr></table></body></html>`;
}

/** Envoie un e-mail au compte. Renvoie false si l'envoi n'est pas configuré ou échoue (jamais bloquant pour une alerte). */
export async function sendMail(u: User, subject: { fr: string; en: string }, build: (lang: 'fr' | 'en') => Mail): Promise<boolean> {
  const key = Deno.env.get('BREVO_API_KEY'), sender = Deno.env.get('BREVO_SENDER');
  if (!key || !sender || !u.email) return false;
  const lang = userLang(u);
  const anti = typeof u.user_metadata?.anti_phishing === 'string' && u.user_metadata.anti_phishing ? String(u.user_metadata.anti_phishing) : null;
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { name: 'TokenStudio', email: sender }, to: [{ email: u.email }], subject: subject[lang], htmlContent: layout(lang, build(lang), anti), tags: ['securite'] }),
    });
    return r.ok;
  } catch { return false; }
}

const when = (lang: 'fr' | 'en') => new Date().toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR', { timeZone: 'UTC', dateStyle: 'long', timeStyle: 'short' }) + ' UTC';
const shortAddr = (a: string) => a.slice(0, 6) + '…' + a.slice(-6);

/** Alertes de sécurité par e-mail */
export type AlertKind = 'login_new_device' | 'withdraw' | 'wallet_added' | 'limits' | 'export_key' | 'delete_wallet' | 'anti_phishing';
export function alertMail(u: User, kind: AlertKind, d: Record<string, string | number> = {}) {
  const S: Record<AlertKind, { fr: string; en: string }> = {
    login_new_device: { fr: 'Nouvelle connexion à votre compte TokenStudio', en: 'New sign-in to your TokenStudio account' },
    withdraw: { fr: 'Retrait depuis votre wallet rapide', en: 'Withdrawal from your quick wallet' },
    wallet_added: { fr: 'Nouveau wallet ajouté à votre compte', en: 'New wallet added to your account' },
    limits: { fr: 'Plafond de votre wallet rapide modifié', en: 'Quick wallet cap changed' },
    export_key: { fr: 'Clé de votre wallet rapide exportée', en: 'Quick wallet key exported' },
    delete_wallet: { fr: 'Wallet rapide supprimé', en: 'Quick wallet deleted' },
    anti_phishing: { fr: 'Code anti-hameçonnage modifié', en: 'Anti-phishing code changed' },
  };
  return sendMail(u, S[kind], (lang) => {
    const L = lang === 'en';
    const t = (fr: string, en: string) => (L ? en : fr);
    const date: [string, string] = [t('Date', 'Date'), when(lang)];
    switch (kind) {
      case 'login_new_device': return { title: t('Nouvelle connexion', 'New sign-in'), lead: t('Votre compte vient d\'être ouvert depuis un appareil que nous ne connaissions pas.', 'Your account was just opened from a device we didn\'t know.'), rows: [[t('Appareil', 'Device'), String(d.device ?? '—')], [t('Adresse IP', 'IP address'), String(d.ip ?? '—')], date] };
      case 'withdraw': return { title: t('Retrait envoyé', 'Withdrawal sent'), lead: t('Un retrait vient de partir de votre wallet rapide.', 'A withdrawal just left your quick wallet.'), rows: [[t('Montant', 'Amount'), d.sol + ' SOL'], [t('Vers', 'To'), shortAddr(String(d.to))], [t('Transaction', 'Transaction'), shortAddr(String(d.signature))], date] };
      case 'wallet_added': return { title: t('Wallet ajouté', 'Wallet added'), lead: t('Un nouveau wallet a été lié à votre compte. Par sécurité, il ne pourra recevoir de retraits du wallet rapide que dans 24 heures.', 'A new wallet was linked to your account. For security, it can only receive withdrawals from the quick wallet in 24 hours.'), rows: [[t('Wallet', 'Wallet'), shortAddr(String(d.address))], date] };
      case 'limits': return { title: t('Plafond modifié', 'Cap changed'), lead: t('Le plafond de dépense de votre wallet rapide a changé.', 'Your quick wallet spending cap changed.'), rows: [[t('Avant', 'Before'), d.before + ' SOL / ' + t('jour', 'day')], [t('Après', 'After'), d.after + ' SOL / ' + t('jour', 'day')], date] };
      case 'export_key': return { title: t('Clé exportée', 'Key exported'), lead: t('La clé privée de votre wallet rapide vient d\'être affichée. Quiconque la possède contrôle les fonds de ce wallet.', 'Your quick wallet private key was just displayed. Anyone who has it controls this wallet\'s funds.'), rows: [date] };
      case 'delete_wallet': return { title: t('Wallet rapide supprimé', 'Quick wallet deleted'), lead: t('Le wallet rapide de votre compte a été supprimé du serveur.', 'Your account\'s quick wallet was deleted from the server.'), rows: [date] };
      case 'anti_phishing': return { title: t('Code anti-hameçonnage modifié', 'Anti-phishing code changed'), lead: t('Votre code anti-hameçonnage a changé. Il apparaît désormais en haut de chacun de nos e-mails : un message sans ce code ne vient pas de nous.', 'Your anti-phishing code changed. It now appears at the top of every email we send: a message without it is not from us.'), rows: [date] };
    }
  });
}

export const audit = (uid: string, event: string, detail: Record<string, unknown>) => admin.from('audit_log').insert({ user_id: uid, event, detail });
