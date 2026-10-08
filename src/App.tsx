import { createPortal } from 'react-dom';
import { AuthProvider } from './auth/AuthContext';
import { SignInDialog } from './auth/SignIn';
import { MfaChallenge } from './auth/Mfa';
import { AccountHub } from './account/AccountHub';
import { AccountPage } from './account/AccountPage';
import { usePrefsSync } from './account/usePrefsSync';

/** Les écrans React s'insèrent dans le studio historique par des portails, le temps de migrer page par page */
function Mounts() {
  usePrefsSync();
  const hub = document.getElementById('ts-hub');
  const hubMobile = document.getElementById('ts-hub-m');
  const page = document.getElementById('ts-account-page');
  return (
    <>
      {hub && createPortal(<AccountHub />, hub)}
      {hubMobile && createPortal(<AccountHub mobile />, hubMobile)}
      {page && createPortal(<AccountPage />, page)}
      <SignInDialog />
      <MfaChallenge />
    </>
  );
}

export function App() {
  return <AuthProvider><Mounts /></AuthProvider>;
}
