import { supabase } from '../lib/supabase';
import { invokeSecure } from '../security/stepUp';
import { studio } from '../legacy/bridge';

// Coffre-fort : conversions SOL ↔ USDT/USDC, règles automatiques, destinations (plateformes d'échange) et historique
export const STABLES = { USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' } as const;
export type Stable = keyof typeof STABLES;
export type Asset = 'SOL' | Stable;
export type Quote = { from: Asset; to: Asset; in: number; out: number; minOut: number; impact: number; rate: number; route: string[] };
export type RuleKind = 'surplus' | 'profit' | 'drop' | 'schedule' | 'send';
export type Rule = { id: string; kind: RuleKind; stable: Stable; params: Record<string, number | string>; active: boolean; last_run_at: string | null; last_result: Record<string, unknown> | null; next_at: string | null; created_at: string };
export type Dest = { id: string; address: string; label: string; created_at: string };
export type Move = { id?: string; wallet?: string | null; kind: 'protect' | 'release' | 'send'; stable: string; sol: number | null; stable_amount: number | null; dest?: string | null; signature?: string | null; auto?: boolean; status?: string; error?: string | null; created_at: string };

type Ctx = {
  solUsd: number | null; bal: number | null;
  wallet: { kind: 'server' | 'ext' | 'legacy'; pk: string; name: string } | null;
};
type VaultBridge = { ctx: () => Ctx; signSend: (b64: string, pk?: string) => Promise<string> };
export const bridge = () => (window.PumpStudio as unknown as { vault?: VaultBridge } | undefined)?.vault;
export type { Ctx };

export const vault = <T,>(action: string, body: Record<string, unknown> = {}) => invokeSecure<T>('vault', { action, ...body });
export const getQuote = (from: Asset, to: Asset, amount: number) => vault<Quote>('quote', { from, to, amount });
export const solMarket = () => vault<{ price: number; change24: number }>('market');
const srv = <T,>(action: string, body: Record<string, unknown>) => invokeSecure<T>('server-wallet', { action, ...body });

/** Conversion : wallet rapide (signé par le serveur) ou wallet externe (signé dans le navigateur) */
export async function convert(ctx: Ctx, from: Asset, to: Asset, amount: number): Promise<{ signature?: string; out: number }> {
  const B = bridge();
  const w = ctx.wallet;
  if (!w) throw new Error('Connectez un wallet pour utiliser le coffre-fort.');
  if (w.kind === 'legacy') throw new Error('L\'ancien wallet rapide du navigateur ne signe plus : utilisez le wallet rapide du compte ou votre wallet.');
  if (w.kind === 'server') {
    const r = await srv<{ signature: string; stable: number; sol: number }>('vault_swap', { from, to, amount, address: w.pk });
    return { signature: r.signature, out: from === 'SOL' ? r.stable : r.sol };
  }
  const b = await vault<{ tx: string; quote: Quote }>('build', { from, to, amount, owner: w.pk });
  const signature = await B!.signSend(b.tx, w.pk);
  const protect = from === 'SOL';
  await supabase.from('vault_moves').insert({ kind: protect ? 'protect' : 'release', stable: protect ? to : from, sol: protect ? amount : b.quote.out, stable_amount: protect ? b.quote.out : amount, wallet: w.pk, signature, status: 'ok' });
  return { signature, out: b.quote.out };
}

/** Envoi vers une destination enregistrée : USDT/USDC (wallet rapide ou externe), SOL (wallet rapide) */
export async function sendTo(ctx: Ctx, asset: Asset, to: string, amount: number | 'max', password: string) {
  const w = ctx.wallet;
  if (!w) throw new Error('Connectez un wallet pour envoyer.');
  if (w.kind === 'server') {
    if (asset === 'SOL') return (await srv<{ signature: string }>('withdraw', { address: w.pk, password, to, amount })).signature;
    return (await srv<{ signature: string }>('vault_send', { address: w.pk, password, stable: asset, to, amount })).signature;
  }
  if (asset === 'SOL') throw new Error('Envoyez vos SOL directement depuis votre wallet.');
  if (amount === 'max') throw new Error('Indiquez un montant.');
  const b = await vault<{ tx: string; amount: number }>('send_tx', { stable: asset, to, amount, owner: w.pk });
  const signature = await bridge()!.signSend(b.tx, w.pk);
  await supabase.from('vault_moves').insert({ kind: 'send', stable: asset, stable_amount: amount, wallet: w.pk, dest: to, signature, status: 'ok' });
  return signature;
}

/** Soldes du wallet actif : SOL et stablecoins */
export async function balances(pk: string): Promise<{ SOL: number; USDT: number; USDC: number }> {
  const rpc = studio()?.hub?.rpc;
  if (!rpc) throw new Error('Connexion Solana indisponible.');
  const tok = async (mint: string) => {
    const r = await rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }[] }>('getTokenAccountsByOwner', [pk, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    return (r.value ?? []).reduce((a, x) => a + (x.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
  };
  const [s, t, c] = await Promise.all([rpc<{ value: number }>('getBalance', [pk, { commitment: 'confirmed' }]), tok(STABLES.USDT), tok(STABLES.USDC)]);
  return { SOL: s.value / 1e9, USDT: t, USDC: c };
}

export const loadRules = async () => ((await supabase.from('vault_rules').select('*').order('created_at')).data ?? []) as Rule[];
export const loadDests = async () => ((await supabase.from('vault_addresses').select('*').order('created_at')).data ?? []) as Dest[];
export const loadMoves = async () => ((await supabase.from('vault_moves').select('*').order('created_at', { ascending: false }).limit(50)).data ?? []) as Move[];
