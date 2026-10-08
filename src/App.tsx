import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { SignInDialog } from './auth/SignIn';
import { MfaChallenge } from './auth/Mfa';
import { AccountHub } from './account/AccountHub';
import { AccountPage } from './account/AccountPage';
import { WalletPage } from './wallet/WalletPage';
import { usePrefsSync } from './account/usePrefsSync';
import { useDataSync } from './sync/useDataSync';
import { studio } from './legacy/bridge';

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
}

/** Les écrans React s'insèrent dans le studio historique par des portails, le temps de migrer page par page */
function Mounts() {
  usePrefsSync();
  useConnectBridge();
  const syncPrompt = useDataSync();
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
      <MfaChallenge />
      {syncPrompt}
    </>
  );
}

export function App() {
  return <AuthProvider><Mounts /></AuthProvider>;
}
