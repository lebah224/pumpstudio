import { FUNCTIONS_URL, PUBLISHABLE_KEY, supabase } from './supabase';

type Relay = { url: string; headers: () => Promise<Record<string, string> | null> };
declare global { interface Window { TSRelay?: Relay } }

/**
 * Relais RPC du compte : tant qu'un compte est connecté, le studio lit la blockchain via la fonction `rpc`
 * (clé Helius côté serveur, ou RPC publics joignables depuis un serveur). Une clé personnelle dans
 * Réglages reste prioritaire ; sans compte, le studio garde le RPC public direct.
 */
export function installRpcRelay() {
  const relay: Relay = {
    url: FUNCTIONS_URL + '/rpc',
    headers: async () => {
      const { data } = await supabase.auth.getSession();
      const t = data.session?.access_token;
      return t ? { Authorization: 'Bearer ' + t, apikey: PUBLISHABLE_KEY } : null;
    },
  };
  const set = (on: boolean) => {
    if (on === !!window.TSRelay) return;
    if (on) window.TSRelay = relay; else delete window.TSRelay;
    window.dispatchEvent(new CustomEvent('ts-relay', { detail: on }));
  };
  supabase.auth.getSession().then(({ data }) => set(!!data.session));
  supabase.auth.onAuthStateChange((_e, s) => set(!!s));
}
