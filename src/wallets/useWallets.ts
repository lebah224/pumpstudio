import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { accountStatus, type AccountStatus } from './walletAuth';

/** Adresses des wallets liés au compte connecté, mises à jour après chaque ajout ou retrait */
export function useLinkedWallets(uid: string | null, active: boolean) {
  const [list, setList] = useState<string[] | null>(null);
  useEffect(() => {
    if (!uid) { setList(null); return; }
    let alive = true;
    const load = () => { supabase.from('wallets').select('address').eq('user_id', uid).then(({ data }) => { if (alive) setList((data ?? []).map((x) => x.address as string)); }); };
    if (active) load();
    window.addEventListener('ts-wallets-changed', load);
    return () => { alive = false; window.removeEventListener('ts-wallets-changed', load); };
  }, [uid, active]);
  return list;
}

const statusCache = new Map<string, AccountStatus>();
/** Compte existant pour ce wallet (affiché aux invités : « se connecter » ou « créer un compte ») */
export function useAccountStatus(address: string | null, active: boolean) {
  const [st, setSt] = useState<{ a: string; s: AccountStatus } | null>(null);
  useEffect(() => {
    if (!address || !active) return;
    let alive = true;
    accountStatus(address).then((s) => { statusCache.set(address, s); if (alive) setSt({ a: address, s }); }).catch(() => {});
    return () => { alive = false; };
  }, [address, active]);
  if (!address) return null;
  return st?.a === address ? st.s : statusCache.get(address) ?? null;
}
