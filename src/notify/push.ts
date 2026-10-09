import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { goTo } from '../legacy/bridge';

// Clé publique VAPID : elle identifie notre serveur auprès des services de notification (sa clé privée est dans Vault)
const VAPID_PUBLIC = 'BIv0W-7YXrfW_j-6fBQ8kiumQfr6XOV4u06HGo_IZH4YIKURAWMLytuR3DCQXUt47RmpUvVC56hxKPe1NCEqf5g';

export type PushState = 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const b64u = (s: string) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
const toB64u = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '');

function supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
async function registration() { return navigator.serviceWorker.register('/sw.js', { scope: '/' }); }

/** État des alertes sur cet appareil */
export async function pushState(): Promise<PushState> {
  if (!supported()) return isIos() && !standalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** Nom lisible d'un appareil à partir de son agent utilisateur (« Android · Chrome ») */
export function uaLabel(ua: string) {
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Appareil';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'navigateur';
  return os + ' · ' + br;
}

/** Abonne cet appareil : autorisation du navigateur, abonnement, puis enregistrement sur le compte */
export async function enablePush(userId: string) {
  if (!supported()) throw new Error(isIos() ? 'Sur iPhone, ajoute d\'abord TokenStudio à l\'écran d\'accueil (Partager → Sur l\'écran d\'accueil), puis ouvre-le depuis l\'icône.' : 'Ce navigateur ne gère pas les notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications refusées : autorise-les dans les réglages du navigateur pour ce site.');
  const reg = await registration(); await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(VAPID_PUBLIC) });
  const row = { user_id: userId, endpoint: sub.endpoint, p256dh: toB64u(sub.getKey('p256dh')), auth: toB64u(sub.getKey('auth')), label: uaLabel(navigator.userAgent) };
  const { error } = await supabase.from('push_subscriptions').insert(row);
  if (error && !/duplicate|unique/i.test(error.message)) { await sub.unsubscribe().catch(() => {}); throw new Error(/row-level|policy/i.test(error.message) ? 'Limite de 10 appareils atteinte : retire un ancien appareil.' : error.message); }
}

/** Désabonne cet appareil (le compte et les autres appareils ne changent pas) */
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

export async function testPush() {
  const { data, error } = await supabase.functions.invoke('order-watch', { body: { test: true } });
  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) { try { msg = (await error.context.json()).error || msg; } catch { /* réponse non JSON */ } }
    throw new Error(msg);
  }
  return data as { sent: number; gone: number };
}

export async function listDevices() {
  const { data } = await supabase.from('push_subscriptions').select('id,label,created_at,last_ok_at,endpoint').order('created_at');
  return (data ?? []) as { id: string; label: string | null; created_at: string; last_ok_at: string | null; endpoint: string }[];
}
export async function removeDevice(id: string, endpoint: string) {
  await supabase.from('push_subscriptions').delete().eq('id', id);
  // si c'est cet appareil, on le désabonne aussi dans le navigateur
  const sub = await (await navigator.serviceWorker?.getRegistration('/'))?.pushManager.getSubscription();
  if (sub?.endpoint === endpoint) await sub.unsubscribe();
}

/** Clic sur une notification : le studio s'ouvre sur la bonne page (?page=orders, ou message du service worker) */
export function installPushRouting() {
  const PAGES = ['orders', 'dash', 'wallet', 'mine', 'trade', 'journal', 'account'];
  const open = (url: string) => { try { const p = new URL(url, location.origin).searchParams.get('page'); if (p && PAGES.includes(p)) goTo(p); } catch { /* adresse invalide */ } };
  const p = new URLSearchParams(location.search).get('page');
  if (p && PAGES.includes(p)) { setTimeout(() => goTo(p), 300); history.replaceState(null, '', location.pathname); }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'ts-open') open(e.data.url); });
    // l'appareil déjà abonné garde un service worker à jour
    navigator.serviceWorker.getRegistration('/').then((r) => r?.update()).catch(() => {});
  }
}
