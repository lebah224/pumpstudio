import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './legacy/legacy.css';
import './styles/account.css';
// Studio historique : s'exécute après le chargement du kit Solana (public/vendor/pumpkit.js)
import './legacy/studio.js';
import './legacy/terminal.js';
import { App } from './App';

// Images distantes cassées (logos de tokens) : retirées sans gestionnaire en ligne, compatible avec la CSP
document.addEventListener('error', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && t.tagName === 'IMG' && t.dataset.rmOnError) t.remove();
}, true);

const root = document.getElementById('ts-root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
