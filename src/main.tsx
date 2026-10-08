import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './legacy/legacy.css';
import './styles/account.css';
// Catalogue des wallets (Phantom, Solflare…) partagé avec le studio historique
import './wallets/catalog';
// Studio historique : s'exécute après le chargement du kit Solana (public/vendor/pumpkit.js)
import './legacy/studio.js';
import './legacy/terminal.js';
import { App } from './App';
import { installSelectMenus } from './ui/selectMenu';
import { installRpcRelay } from './lib/rpcRelay';
import { installPushRouting } from './notify/push';
import { installTokenMeta } from './lib/tokenMeta';
import { enterDemoGuest, isDemoGuest, maybeSignedIn } from './lib/guest';

// Sans compte, l'outil s'ouvre seulement en démo (depuis l'accueil) ou pour se connecter avec le wallet rapide
{
  const q = new URLSearchParams(location.search);
  if (q.get('demo') === '1' || q.get('signin') === 'quick') enterDemoGuest();
  if (!maybeSignedIn() && !isDemoGuest()) location.replace('/');
}

// Images distantes cassées (logos de tokens) : retirées sans gestionnaire en ligne, compatible avec la CSP
document.addEventListener('error', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && t.tagName === 'IMG' && t.dataset.rmOnError) t.remove();
}, true);

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
