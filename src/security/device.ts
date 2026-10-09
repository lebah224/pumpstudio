import { uaLabel } from '../notify/push';
import { security } from './stepUp';

/**
 * Appareil connu : un identifiant aléatoire gardé dans ce navigateur (jamais lié au matériel) est signalé au serveur
 * une fois par session ; à la première connexion d'un nouvel appareil, le serveur envoie une alerte par e-mail.
 */
const KEY = 'ts-device-id';
function deviceId(): string | null {
  try {
    let v = localStorage.getItem(KEY);
    if (!v || !/^[0-9a-f-]{36}$/.test(v)) { v = crypto.randomUUID(); localStorage.setItem(KEY, v); }
    return v;
  } catch { return null; }
}
export function registerDevice(userId: string) {
  const id = deviceId(); if (!id) return;
  const flag = 'ts-device-seen:' + userId;
  try { if (sessionStorage.getItem(flag)) return; sessionStorage.setItem(flag, '1'); } catch { /* navigation privée */ }
  security('device', { device_id: id, label: uaLabel(navigator.userAgent) }).catch(() => {
    try { sessionStorage.removeItem(flag); } catch { /* navigation privée */ }
  });
}
