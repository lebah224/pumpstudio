import { studio } from '../legacy/bridge';
import { disablePush } from '../notify/push';
import { leaveDemoGuest } from '../lib/guest';
import { releaseBrowser, syncStore } from '../sync/dataSync';

/**
 * Déconnexion complète, depuis n'importe quel écran : alertes coupées sur ce navigateur, compte fermé,
 * extension déconnectée et wallet rapide mis de côté (il reste chiffré ici), puis retour à la page de connexion.
 */
export async function logoutEverywhere(signOut: (all?: boolean) => Promise<unknown>, all = false) {
  // les alertes de ce compte ne doivent pas arriver sur un navigateur dont on se déconnecte
  await disablePush().catch(() => {});
  // dernière sauvegarde sur le compte, puis les données réelles quittent ce navigateur
  await releaseBrowser(syncStore.get().userId).catch(() => {});
  await signOut(all).catch(() => {});
  await studio()?.hub?.signOut().catch(() => {});
  leaveDemoGuest();
  location.replace('/connexion');
}
