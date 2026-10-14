import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { SignInDialog } from './auth/SignIn';
import { MfaChallenge } from './auth/Mfa';
import { AccountHub } from './account/AccountHub';
import { AccountPage } from './account/AccountPage';
import { WalletPage } from './wallet/WalletPage';
import { TraderPage } from './trader/TraderPage';
import { VaultPage } from './vault/VaultPage';
import { usePrefsSync } from './account/usePrefsSync';
import { useCloud } from './data/cloud';
import { CloudNotice } from './data/CloudNotice';
import { studio } from './legacy/bridge';
import { clearServerWallet, refreshServerWallet } from './serverWallet/api';
import { ServerWalletDialog } from './serverWallet/ServerWalletDialog';
import { isLeaving, isQuickSignIn } from './lib/guest';
import { loadProfile } from './account/profile';
import { Onboarding } from './account/Onboarding';
import { StepUpDialog } from './security/StepUpDialog';
import { registerDevice } from './security/device';

/** Le studio demande une connexion (wallet manquant, opération sans compte) : on ouvre la fenêtre de connexion du compte */
function useConnectBridge() {
  const { ready, user, needsMfa, openSignIn } = useAuth();
  const signed = !!user && !needsMfa;
  useEffect(() => {
    (window as unknown as { __tsConnectUI?: boolean }).__tsConnectUI = true;
    const onConnect = () => openSignIn(signed ? { start: 'add' } : { start: 'choose' });
    const onNeed = () => openSignIn({ start: 'choose', reason: 'real' });
    window.addEventListener('ts-connect', onConnect); window.addEventListener('ts-need-account', onNeed);
    return () => { window.removeEventListener('ts-connect', onConnect); window.removeEventListener('ts-need-account', onNeed); };
  }, [signed, openSignIn]);
  // les opérations demandent un compte connecté
  useEffect(() => { if (ready) studio()?.hub?.setAuth(signed); }, [ready, signed]);
  // profil du compte (nom, nom d'utilisateur, avatar) pour le menu et la fenêtre de bienvenue
  useEffect(() => { if (ready) loadProfile(signed ? user!.id : null); }, [ready, signed, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // appareil connu ou nouveau (alerte e-mail à la première connexion d'un nouvel appareil)
  useEffect(() => { if (ready && signed) registerDevice(user!.id); }, [ready, signed, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // wallet rapide serveur du compte (s'il existe)
  useEffect(() => { if (!ready) return; if (signed) refreshServerWallet(); else clearServerWallet(); }, [ready, signed, user?.id]);
  // sans compte, l'outil renvoie vers la page de connexion (l'écran de chargement reste affiché jusque-là) ;
  // avec un compte confirmé, l'interface apparaît
  useEffect(() => {
    if (!ready) return;
    if (!user && !isQuickSignIn() && !isLeaving()) { location.replace('/connexion'); return; }
    window.__tsBoot?.done();
  }, [ready, user]);
  // arrivée depuis la page de connexion : ?signin=quick (ancien wallet rapide), puis adresse nettoyée
  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams(location.search);
    if (q.get('signin') !== 'quick') return;
    if (!signed) openSignIn({ start: 'quick' });
    q.delete('signin');
    history.replaceState(null, '', location.pathname + (q.size ? '?' + q : '') + location.hash);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Les écrans React s'insèrent dans le studio historique par des portails, le temps de migrer page par page */
function Mounts() {
  usePrefsSync();
  useConnectBridge();
  useCloud();
  const hub = document.getElementById('ts-hub');
  const hubMobile = document.getElementById('ts-hub-m');
  const page = document.getElementById('ts-account-page');
  const wallet = document.getElementById('ts-wallet-page');
  const trader = document.getElementById('ts-trader');
  const vaultEl = document.getElementById('ts-vault-page');
  return (
    <>
      {hub && createPortal(<AccountHub />, hub)}
      {hubMobile && createPortal(<AccountHub mobile />, hubMobile)}
      {page && createPortal(<AccountPage />, page)}
      {wallet && createPortal(<WalletPage />, wallet)}
      {trader && createPortal(<TraderPage />, trader)}
      {vaultEl && createPortal(<VaultPage />, vaultEl)}
      <SignInDialog />
      <ServerWalletDialog />
      <StepUpDialog />
      <MfaChallenge />
      <Onboarding />
      <CloudNotice />
    </>
  );
}

export function App() {
  return <AuthProvider guestPages><Mounts /></AuthProvider>;
}
