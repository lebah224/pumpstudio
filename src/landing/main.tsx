import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import '../styles/account.css';
import { AuthProvider } from '../auth/AuthContext';
import { Landing } from './Landing';
import { AuthPage } from './AuthPage';

// Trois adresses servies par cette page : l'accueil, la connexion et l'inscription. L'outil vit sur /app.
const path = location.pathname.replace(/\/+$/, '') || '/';
// anciens liens vers l'outil (« /?page=orders », alertes envoyées avant /app)
if (path === '/' && new URLSearchParams(location.search).has('page')) location.replace('/app' + location.search);
const page = path === '/connexion' ? <AuthPage signup={false} />
  : path === '/inscription' ? <AuthPage signup />
  : <Landing />;
document.title = path === '/connexion' ? 'Connexion · TokenStudio'
  : path === '/inscription' ? 'Créer un compte · TokenStudio'
  : document.title;

const root = document.getElementById('lp-root');
if (root) createRoot(root).render(<StrictMode><AuthProvider>{page}</AuthProvider></StrictMode>);
