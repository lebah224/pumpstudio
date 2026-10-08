import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Wallet } from '../lib/types';

type Provider = { connect: () => Promise<unknown>; publicKey?: { toString: () => string } | null; signMessage: (m: Uint8Array, enc?: string) => Promise<{ signature: Uint8Array } | Uint8Array> };

function provider(): Provider {
  const w = window as unknown as Record<string, any>;
  const p = w.phantom?.solana ?? w.solflare ?? w.backpack?.solana ?? w.solana;
  if (!p?.signMessage) throw new Error('Aucun wallet Solana détecté dans ce navigateur (Phantom, Solflare ou Backpack).');
  return p as Provider;
}

const b64 = (u8: Uint8Array) => { let s = ''; u8.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };

/**
 * Lie un wallet au compte : le wallet signe un message gratuit (aucune transaction),
 * la fonction serveur vérifie la signature ed25519, le compte, le domaine et la date, puis enregistre l'adresse.
 */
export async function linkWallet(): Promise<Wallet> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Connecte-toi d\'abord.');
  const p = provider();
  await p.connect();
  const address = p.publicKey?.toString();
  if (!address) throw new Error('Le wallet n\'a pas donné son adresse.');
  const message = [
    'TokenStudio : lier ce wallet à mon compte.',
    'Compte : ' + session.user.id,
    'Wallet : ' + address,
    'Domaine : ' + location.host,
    'Date : ' + new Date().toISOString(),
    'Cette signature est gratuite et n\'autorise aucune transaction.',
  ].join('\n');
  const res = await p.signMessage(new TextEncoder().encode(message), 'utf8');
  const sig = res instanceof Uint8Array ? res : res.signature;
  const { data, error } = await supabase.functions.invoke('link-wallet', { body: { address, message, signature: b64(sig) } });
  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) { try { msg = (await error.context.json()).error || msg; } catch { /* réponse non JSON */ } }
    throw new Error(msg);
  }
  return (data as { wallet: Wallet }).wallet;
}
