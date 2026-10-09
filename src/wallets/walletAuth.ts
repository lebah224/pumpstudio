import { signAsync } from '@noble/ed25519';
import { invokeSecure } from '../security/stepUp';
import { supabase } from '../lib/supabase';
import { studio } from '../legacy/bridge';
import type { Wallet } from '../lib/types';
import { detect, type SolProvider } from './catalog';
import { t } from '../lib/i18n';

/** Wallet avec lequel on signe : une extension (Phantom…) ou le wallet rapide du studio */
export type Source = { kind: 'ext'; id: string } | { kind: 'quick' };
export type AccountStatus = 'web3' | 'linked' | 'none';

type Signer = { address: string; signMessage: (m: Uint8Array) => Promise<Uint8Array>; provider: SolProvider | null };

const b64 = (u8: Uint8Array) => { let s = ''; u8.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
const nonce = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Signataire d'un message (jamais d'une transaction) : l'extension, ou la clé du wallet rapide déverrouillé */
export function signerFor(src: Source): Signer {
  if (src.kind === 'quick') {
    const kp = studio()?.hub?.quickKeypair();
    if (!kp) throw new Error('Déverrouillez d\'abord votre wallet rapide.');
    return { address: kp.publicKey.toBase58(), provider: null, signMessage: (m) => signAsync(m, kp.secretKey.slice(0, 32)) };
  }
  const p = detect().find((x) => x.id === src.id)?.p;
  const address = p?.publicKey?.toString();
  if (!p || !address) throw new Error(t('Wallet non connecté : reconnectez-le puis réessayez.', 'Wallet not connected: reconnect it and try again.'));
  return {
    address, provider: p,
    signMessage: async (m) => { const r = await p.signMessage(m, 'utf8'); return r instanceof Uint8Array ? r : r.signature; },
  };
}

/** Un compte existe-t-il pour cette adresse ? (connexion par wallet, wallet lié à un compte, ou aucun) */
export async function accountStatus(address: string): Promise<AccountStatus> {
  const { data, error } = await supabase.rpc('wallet_account_status', { addr: address });
  if (error) throw new Error(t('Vérification du compte impossible : ', 'Could not check the account: ') + error.message);
  return data === 'web3' || data === 'linked' ? data : 'none';
}

const STATEMENT = () => t('Connexion à TokenStudio. Cette signature est gratuite : elle prouve que ce wallet vous appartient et n\'autorise aucune transaction.', 'Sign in to TokenStudio. This signature is free: it proves this wallet is yours and authorizes no transaction.');

/** Connexion Supabase native (Sign-In With Solana) : crée le compte s'il n'existe pas, donc appelée seulement après accord */
async function web3SignIn(s: Signer, captchaToken?: string) {
  // Phantom propose signIn (Sign-In With Solana) ; sinon on passe un adaptateur qui renvoie toujours des octets,
  // car plusieurs wallets répondent à signMessage par { signature } au lieu d'un Uint8Array
  const wallet = typeof s.provider?.signIn === 'function' ? s.provider
    : { publicKey: { toBase58: () => s.address }, signMessage: (m: Uint8Array) => s.signMessage(m) };
  const { error } = await supabase.auth.signInWithWeb3({ chain: 'solana', statement: STATEMENT(), wallet: wallet as never, options: captchaToken ? { captchaToken } : undefined });
  if (error) throw error;
}

// ajout d'un wallet sur un compte qui a un wallet rapide : le serveur demande un code de confirmation
const invoke = <T,>(fn: string, body: Record<string, unknown>): Promise<T> => invokeSecure<T>(fn, body);

/**
 * Connexion à un compte existant avec ce wallet. Ne crée jamais de compte :
 * renvoie 'none' quand aucun compte n'existe, pour laisser l'utilisateur choisir.
 */
export async function signInWithWallet(src: Source, captchaToken?: string): Promise<'ok' | 'none'> {
  const s = signerFor(src);
  const st = await accountStatus(s.address);
  if (st === 'none') return 'none';
  if (st === 'web3') { await web3SignIn(s, captchaToken); return 'ok'; }
  // wallet lié à un compte (ajouté depuis Mon compte) : la fonction serveur vérifie la signature et ouvre la session
  const message = [
    'TokenStudio : connexion avec ce wallet.',
    'Wallet : ' + s.address,
    'Domaine : ' + location.host,
    'Date : ' + new Date().toISOString(),
    'Nonce : ' + nonce(),
    'Cette signature est gratuite et n\'autorise aucune transaction.',
  ].join('\n');
  const sig = await s.signMessage(new TextEncoder().encode(message));
  const { token_hash } = await invoke<{ token_hash: string }>('wallet-login', { address: s.address, message, signature: b64(sig), captchaToken });
  const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' });
  if (error) throw error;
  return 'ok';
}

/** Création explicite d'un compte avec ce wallet (après accord de l'utilisateur) */
export async function createAccountWithWallet(src: Source, captchaToken?: string) {
  const s = signerFor(src);
  if ((await accountStatus(s.address)) !== 'none') { await signInWithWallet(src, captchaToken); return; }
  await web3SignIn(s, captchaToken);
}

/**
 * Lie un wallet au compte connecté : le wallet signe un message gratuit (aucune transaction),
 * la fonction serveur vérifie la signature ed25519, le compte, le domaine et la date, puis enregistre l'adresse.
 */
export async function linkWallet(src: Source): Promise<Wallet> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Connectez-vous d\'abord.');
  const s = signerFor(src);
  const message = [
    'TokenStudio : lier ce wallet à mon compte.',
    'Compte : ' + session.user.id,
    'Wallet : ' + s.address,
    'Domaine : ' + location.host,
    'Date : ' + new Date().toISOString(),
    'Cette signature est gratuite et n\'autorise aucune transaction.',
  ].join('\n');
  const sig = await s.signMessage(new TextEncoder().encode(message));
  const { wallet } = await invoke<{ wallet: Wallet }>('link-wallet', { address: s.address, message, signature: b64(sig) });
  window.dispatchEvent(new CustomEvent('ts-wallets-changed'));
  return wallet;
}
