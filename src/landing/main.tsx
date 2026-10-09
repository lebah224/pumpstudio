import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import '../styles/account.css';
import { AuthProvider } from '../auth/AuthContext';
import { initLang, t } from '../lib/i18n';
import { Landing } from './Landing';
import { AuthPage } from './AuthPage';
import { LegalPage, legalTitle, type LegalId } from './Legal';

// Adresses servies par cette page : l'accueil, la connexion, l'inscription et les pages légales. L'outil vit sur /app.
initLang();
const path = location.pathname.replace(/\/+$/, '') || '/';
// anciens liens vers l'outil (« /?page=orders », alertes envoyées avant /app)
if (path === '/' && new URLSearchParams(location.search).has('page')) location.replace('/app' + location.search);
const LEGAL: Record<string, LegalId> = { '/conditions': 'terms', '/confidentialite': 'privacy', '/risques': 'risks', '/mentions-legales': 'notice' };
const legal = LEGAL[path];
const page = path === '/connexion' ? <AuthPage signup={false} />
  : path === '/inscription' ? <AuthPage signup />
  : legal ? <LegalPage id={legal} />
  : <Landing />;
document.title = path === '/connexion' ? t('Connexion', 'Sign in') + ' · TokenStudio'
  : path === '/inscription' ? t('Créer un compte', 'Create an account') + ' · TokenStudio'
  : legal ? legalTitle(legal) + ' · TokenStudio'
  : t('TokenStudio · Crée, lance et pilote tes tokens Solana', 'TokenStudio · Create, launch and manage your Solana tokens');
const desc = document.querySelector('meta[name="description"]');
if (desc && !legal) desc.setAttribute('content', t(desc.getAttribute('content') ?? '', 'From concept to launch on pump.fun, then tracking, trading and automatic orders. Non-custodial: your keys stay in your wallet. Free demo, no account needed.'));

const root = document.getElementById('lp-root');
if (root) createRoot(root).render(<StrictMode><AuthProvider>{page}</AuthProvider></StrictMode>);
