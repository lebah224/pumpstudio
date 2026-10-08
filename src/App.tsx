import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { SignInDialog } from './auth/SignIn';
import { MfaChallenge } from './auth/Mfa';
import { AccountHub } from './account/AccountHub';
import { AccountPage } from './account/AccountPage';
import { WalletPage } from './wallet/WalletPage';
import { usePrefsSync } from './account/usePrefsSync';
import { useCloud } from './data/cloud';
import { CloudNotice } from './data/CloudNotice';
import { studio } from './legacy/bridge';
import { clearServerWallet, refreshServerWallet } from './serverWallet/api';
import { ServerWalletDialog } from './serverWallet/ServerWalletDialog';
import { isDemoGuest, isLeaving } from './lib/guest';
import { loadProfile } from './account/profile';
import { Onboarding } from './account/Onboarding';

/** Le studio demande une connexion (wallet manquant, passage en réel) : on ouvre la fenêtre de connexion du compte */
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
  // mode réel réservé aux comptes connectés : le studio repasse en simulation sinon
  useEffect(() => { if (ready) studio()?.hub?.setAuth(signed); }, [ready, signed]);
  // profil du compte (nom, nom d'utilisateur, avatar) pour le menu et la fenêtre de bienvenue
  useEffect(() => { if (ready) loadProfile(signed ? user!.id : null); }, [ready, signed, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // wallet rapide serveur du compte (s'il existe)
  useEffect(() => { if (!ready) return; if (signed) refreshServerWallet(); else clearServerWallet(); }, [ready, signed, user?.id]);
  // sans compte, l'outil n'est ouvert qu'en démo : sinon retour à l'accueil
  useEffect(() => { if (ready && !user && !isDemoGuest() && !isLeaving()) location.replace('/'); }, [ready, user]);
  // arrivée depuis l'accueil : ?demo=1 (essayer la démo) ou ?signin=quick (wallet rapide), puis adresse nettoyée
  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams(location.search);
    const demo = q.get('demo') === '1', quick = q.get('signin') === 'quick';
    if (!demo && !quick) return;
    if (demo) studio()?.hub?.goSim();
    if (quick && !signed) openSignIn({ start: 'quick' });
    q.delete('demo'); q.delete('signin');
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
  return (
    <>
      {hub && createPortal(<AccountHub />, hub)}
      {hubMobile && createPortal(<AccountHub mobile />, hubMobile)}
      {page && createPortal(<AccountPage />, page)}
      {wallet && createPortal(<WalletPage />, wallet)}
      <SignInDialog />
      <ServerWalletDialog />
      <MfaChallenge />
      <Onboarding />
      <CloudNotice />
    </>
  );
}

export function App() {
  return <AuthProvider guestPages><Mounts /></AuthProvider>;
}
