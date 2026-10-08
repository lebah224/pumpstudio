import { createPortal } from 'react-dom';
import { AuthProvider } from './auth/AuthContext';
import { SignInDialog } from './auth/SignIn';
import { MfaChallenge } from './auth/Mfa';
import { AccountChip } from './account/AccountChip';
import { AccountPage } from './account/AccountPage';
import { usePrefsSync } from './account/usePrefsSync';

/** Les écrans React s'insèrent dans le studio historique par des portails, le temps de migrer page par page */
function Mounts() {
  usePrefsSync();
  const chip = document.getElementById('ts-account-chip');
  const page = document.getElementById('ts-account-page');
  return (
    <>
      {chip && createPortal(<AccountChip />, chip)}
      {page && createPortal(<AccountPage />, page)}
      <SignInDialog />
      <MfaChallenge />
    </>
  );
}

export function App() {
  return <AuthProvider><Mounts /></AuthProvider>;
}
