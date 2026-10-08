// Catalogue des wallets Solana pris en charge : détection de l'extension, installation et ouverture sur téléphone.
// Partagé avec le studio historique (window.TSWallets) pour qu'un seul endroit décide quels wallets existent.

export type SolProvider = {
  publicKey?: { toString: () => string; toBase58?: () => string } | null;
  isConnected?: boolean;
  connect: (o?: unknown) => Promise<unknown>;
  disconnect?: () => Promise<void>;
  signMessage: (m: Uint8Array, enc?: string) => Promise<{ signature: Uint8Array } | Uint8Array>;
  signIn?: unknown;
};

export type WalletInfo = {
  id: string;
  name: string;
  /** couleur de la pastille (initiales) */
  color: string;
  install: string;
  /** lien qui ouvre le studio dans le navigateur intégré de l'app, sur téléphone */
  mobile?: (url: string, ref: string) => string;
  get: () => SolProvider | undefined;
};

const w = window as unknown as Record<string, any>;
const enc = encodeURIComponent;

export const WALLETS: WalletInfo[] = [
  { id: 'phantom', name: 'Phantom', color: '#ab9ff2', install: 'https://phantom.com/download',
    mobile: (u, r) => 'https://phantom.app/ul/browse/' + enc(u) + '?ref=' + enc(r), get: () => (w.phantom?.solana?.isPhantom ? w.phantom.solana : undefined) },
  { id: 'solflare', name: 'Solflare', color: '#fc7227', install: 'https://solflare.com/download',
    mobile: (u, r) => 'https://solflare.com/ul/v1/browse/' + enc(u) + '?ref=' + enc(r), get: () => (w.solflare?.isSolflare ? w.solflare : undefined) },
  { id: 'backpack', name: 'Backpack', color: '#e33e3f', install: 'https://backpack.app/downloads',
    mobile: (u, r) => 'https://backpack.app/ul/v1/browse/' + enc(u) + '?ref=' + enc(r), get: () => w.backpack?.solana ?? (w.backpack?.isBackpack ? w.backpack : undefined) },
  { id: 'coinbase', name: 'Coinbase Wallet', color: '#0052ff', install: 'https://www.coinbase.com/wallet/downloads',
    mobile: (u) => 'https://go.cb-w.com/dapp?cb_url=' + enc(u), get: () => w.coinbaseSolana },
  { id: 'okx', name: 'OKX Wallet', color: '#3d3d3d', install: 'https://web3.okx.com/download',
    mobile: (u) => 'okx://wallet/dapp/url?dappUrl=' + enc(u), get: () => w.okxwallet?.solana },
  { id: 'trust', name: 'Trust Wallet', color: '#0500ff', install: 'https://trustwallet.com/download',
    mobile: (u) => 'https://link.trustwallet.com/open_url?coin_id=501&url=' + enc(u), get: () => w.trustwallet?.solana ?? (w.solana?.isTrust ? w.solana : undefined) },
  { id: 'magiceden', name: 'Magic Eden', color: '#e42575', install: 'https://wallet.magiceden.io/download', get: () => w.magicEden?.solana },
  { id: 'bitget', name: 'Bitget Wallet', color: '#1fb6c9', install: 'https://web3.bitget.com/wallet-download', get: () => w.bitkeep?.solana },
];

/** Wallet générique injecté sous window.solana quand aucun wallet connu n'est reconnu */
const GENERIC: WalletInfo = { id: 'solana', name: 'Wallet du navigateur', color: '#7c8595', install: '', get: () => w.solana };

export function detect(): (WalletInfo & { p: SolProvider })[] {
  const out = WALLETS.map((x) => ({ ...x, p: x.get() })).filter((x): x is WalletInfo & { p: SolProvider } => !!x.p);
  const g = GENERIC.get();
  if (g && !out.some((x) => x.p === g)) out.push({ ...GENERIC, p: g });
  return out;
}

export const walletById = (id: string): WalletInfo | undefined => (id === GENERIC.id ? GENERIC : WALLETS.find((x) => x.id === id));
export const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
export const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

/** Wallets à proposer : ceux détectés d'abord, puis les autres (installation ou ouverture dans l'app) */
export function walletChoices() {
  const found = detect();
  const ids = new Set(found.map((x) => x.id));
  return { found, others: WALLETS.filter((x) => !ids.has(x.id)) };
}

(window as unknown as { TSWallets: unknown }).TSWallets = { detect };
