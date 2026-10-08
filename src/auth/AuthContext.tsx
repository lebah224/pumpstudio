import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

type Aal = 'aal1' | 'aal2' | null;
/** Ouverture de la fenêtre de connexion : écran de départ, wallet déjà choisi, raison affichée */
export type SignInIntent = { start?: 'choose' | 'quick' | 'email' | 'add'; wallet?: string; reason?: 'real' };
type AuthState = {
  ready: boolean;
  session: Session | null;
  user: User | null;
  /** niveau d'assurance actuel et requis : aal2 quand la double authentification est activée */
  aal: { current: Aal; next: Aal };
  needsMfa: boolean;
  refreshAal: () => Promise<void>;
  signOut: (everywhere?: boolean) => Promise<void>;
  signInOpen: SignInIntent | null;
  openSignIn: (open?: boolean | SignInIntent) => void;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [aal, setAal] = useState<{ current: Aal; next: Aal }>({ current: null, next: null });
  const [signInOpen, setSignInOpen] = useState<SignInIntent | null>(null);

  const refreshAal = useCallback(async () => {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setAal({ current: (data?.currentLevel as Aal) ?? null, next: (data?.nextLevel as Aal) ?? null });
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (!alive) return; setSession(data.session); setReady(true); if (data.session) refreshAal(); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) { setSignInOpen((o) => (o?.start === 'add' ? o : null)); refreshAal(); } else setAal({ current: null, next: null });
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [refreshAal]);

  const signOut = useCallback(async (everywhere?: boolean) => {
    await supabase.auth.signOut({ scope: everywhere ? 'global' : 'local' });
  }, []);

  const value = useMemo<AuthState>(() => ({
    ready, session, user: session?.user ?? null, aal,
    needsMfa: !!session && aal.next === 'aal2' && aal.current !== 'aal2',
    refreshAal, signOut, signInOpen, openSignIn: (open = true) => setSignInOpen(open === false ? null : open === true ? {} : open),
  }), [ready, session, aal, refreshAal, signOut, signInOpen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return v;
}

/** Libellé court d'un utilisateur : e-mail, sinon adresse du wallet de connexion */
export function userLabel(u: User | null) {
  if (!u) return '';
  if (u.email) return u.email;
  const addr = walletOf(u);
  return addr ? addr.slice(0, 4) + '…' + addr.slice(-4) : 'Compte';
}
export function walletOf(u: User | null): string | null {
  const id = u?.identities?.find((i) => i.provider === 'web3');
  const a = (id?.identity_data as { address?: string } | undefined)?.address || id?.id?.split(':').pop();
  return a && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? a : null;
}
