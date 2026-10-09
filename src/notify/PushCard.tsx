import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { toast } from '../legacy/bridge';
import { disablePush, enablePush, listDevices, pushState, removeDevice, testPush, type PushState } from './push';

const STATE: Record<PushState, [string, string]> = {
  on: ['Activées sur cet appareil', 'g'],
  off: ['Désactivées sur cet appareil', ''],
  denied: ['Bloquées par le navigateur', 'r'],
  unsupported: ['Non disponibles sur ce navigateur', ''],
  'ios-install': ['Installez d\'abord l\'appli', 'a'],
};

/** Alertes push : abonnement de cet appareil, test, liste des appareils du compte */
export function PushCard({ enabled }: { enabled: boolean }) {
  const { user } = useAuth();
  const [st, setSt] = useState<PushState | null>(null);
  const [devices, setDevices] = useState<Awaited<ReturnType<typeof listDevices>>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(async () => { setSt(await pushState()); setDevices(await listDevices()); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  if (!user) return null;

  const run = (k: string, fn: () => Promise<void>) => async () => {
    setBusy(k);
    try { await fn(); } catch (e) { toast('Action impossible', (e as Error).message, 'r'); } finally { setBusy(null); refresh(); }
  };
  const on = run('on', async () => { await enablePush(user.id); toast('Alertes activées', 'Cet appareil recevra une notification quand un ordre se déclenche.'); });
  const off = run('off', async () => { await disablePush(); toast('Alertes désactivées sur cet appareil', '', ''); });
  const test = run('test', async () => { const r = await testPush(); if (r.sent) toast('Notification envoyée', r.sent > 1 ? r.sent + ' appareils' : 'Elle doit apparaître dans quelques secondes.'); else toast('Aucun appareil joint', 'Activez d\'abord les alertes sur cet appareil.', 'a'); });

  const [label, tone] = st ? STATE[st] : ['…', ''];
  return (
    <div className="ts-push">
      <div className="ts-push-h">
        <div><b>Alertes sur vos appareils</b><small>Le serveur surveille vos ordres toutes les 10 secondes, même outil fermé, et vous envoie une notification. Si votre wallet rapide détient le token, il vend aussi pour vous (ventes automatiques) ; sinon, c'est vous qui validez.</small></div>
        <span className={'badge ' + tone}>{label}</span>
      </div>
      {st === 'ios-install' && <div className="ts-note warn">Sur iPhone, les notifications marchent dans l'appli installée : touchez <b>Partager</b> puis <b>Sur l'écran d'accueil</b>, et ouvrez TokenStudio depuis son icône.</div>}
      {st === 'denied' && <div className="ts-note warn">Les notifications sont bloquées pour ce site. Autorisez-les dans les réglages du navigateur (icône à gauche de l'adresse), puis réessayez.</div>}
      {!enabled && <div className="ts-note">Cochez « M'alerter quand un ordre se déclenche » pour recevoir les alertes.</div>}
      <div className="ts-row">
        {st === 'on'
          ? <><button type="button" className="btn sm" disabled={!!busy} onClick={test}>{busy === 'test' ? 'Envoi…' : 'Envoyer un test'}</button><button type="button" className="btn sm ghost" disabled={!!busy} onClick={off}>Désactiver sur cet appareil</button></>
          : <button type="button" className="btn sm primary" disabled={!!busy || st === 'unsupported' || st === 'ios-install' || st === 'denied'} onClick={on}>{busy === 'on' ? 'Autorisation…' : 'Activer sur cet appareil'}</button>}
      </div>
      {devices.length > 0 && (
        <ul className="ts-push-dev">
          {devices.map((d) => (
            <li key={d.id}><span><b>{d.label || 'Appareil'}</b><small>ajouté le {new Date(d.created_at).toLocaleDateString('fr-FR')}{d.last_ok_at ? ' · dernière alerte ' + new Date(d.last_ok_at).toLocaleDateString('fr-FR') : ''}</small></span>
              <button type="button" className="btn sm ghost" onClick={run('rm' + d.id, async () => { await removeDevice(d.id, d.endpoint); })}>Retirer</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
