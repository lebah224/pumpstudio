import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './legacy/legacy.css';
import './styles/account.css';
// Catalogue des wallets (Phantom, Solflare…) partagé avec le studio historique
import './wallets/catalog';
// Règle des mots de passe, aussi utilisée par le studio historique (window.TSPassword)
import './lib/password';
import { App } from './App';
import { installSelectMenus } from './ui/selectMenu';
import { installRpcRelay } from './lib/rpcRelay';
import { installPushRouting } from './notify/push';
import { installTokenMeta } from './lib/tokenMeta';
import { isQuickSignIn, maybeSignedIn } from './lib/guest';

// Sans compte, l'outil ne s'ouvre que pour se connecter avec l'ancien wallet rapide
if (!maybeSignedIn() && !isQuickSignIn()) location.replace('/connexion');

// Images distantes cassées (logos de tokens) : retirées sans gestionnaire en ligne, compatible avec la CSP
document.addEventListener('error', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && t.tagName === 'IMG' && t.dataset.rmOnError) t.remove();
}, true);

// ancien module de trading automatique (retiré) : ses données restées dans le navigateur sont effacées
try { Object.keys(localStorage).filter((k) => k.startsWith('pstudio_pb_') || k === 'pb-exec').forEach((k) => localStorage.removeItem(k)); } catch { /* navigation privée */ }
try { indexedDB.deleteDatabase('pstudio_pumpbot'); } catch { /* navigateur sans IndexedDB */ }

declare global { interface Window { __tsBoot?: { done: () => void; fail: (e: unknown) => void } } }

function start() {
  // listes de choix aux couleurs du studio, pour tout l'outil
  installSelectMenus();
  // RPC du compte : lecture de la blockchain sans clé Helius personnelle
  installRpcRelay();
  // clic sur une alerte : le studio s'ouvre sur la page des ordres
  installPushRouting();
  // logo et fiche des tokens envoyés par le serveur (pas de clé Pinata nécessaire)
  installTokenMeta();
  const root = document.getElementById('ts-root');
  if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
}
// Studio historique (après le kit Solana, public/vendor/pumpkit.js) : chargé à part, pour qu'une erreur de sa part
// (donnée locale illisible…) n'empêche pas l'outil de démarrer ; la garde de démarrage propose alors de réparer.
import('./legacy/studio.js')
  .then(start)
  .catch((e) => { console.error(e); window.__tsBoot?.fail(e); try { start(); } catch (e2) { window.__tsBoot?.fail(e2); } });
