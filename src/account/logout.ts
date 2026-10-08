import { studio } from '../legacy/bridge';
import { disablePush } from '../notify/push';
import { leaveDemoGuest, markLeaving } from '../lib/guest';
import { detachCloud } from '../data/cloud';

/**
 * Déconnexion complète, depuis n'importe quel écran : alertes coupées sur ce navigateur, compte fermé,
 * extension déconnectée et wallet rapide mis de côté (il reste chiffré ici), puis retour à la page de connexion.
 */
export async function logoutEverywhere(signOut: (all?: boolean) => Promise<unknown>, all = false) {
  markLeaving();
  // les alertes de ce compte ne doivent pas arriver sur un navigateur dont on se déconnecte
  await disablePush().catch(() => {});
  // derniers changements écrits dans la base, puis plus rien du compte ne reste dans l'outil
  await detachCloud().catch(() => {});
  await signOut(all).catch(() => {});
  await studio()?.hub?.signOut().catch(() => {});
  leaveDemoGuest();
  location.replace('/connexion');
}
