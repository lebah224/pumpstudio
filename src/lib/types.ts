export type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  locale: 'fr' | 'en';
  timezone: string;
  onboarded: boolean;
  created_at: string;
  updated_at: string;
};

export type Preferences = {
  user_id: string;
  ui_theme: 'or' | 'platine' | 'saphir' | 'jade' | 'cuivre' | 'iris';
  ui_depth: 'nuit' | 'profond' | 'doux';
  sim_mode: boolean;
  slippage_pct: number;
  max_buy_sol: number;
  priority: 'eco' | 'fast' | 'turbo' | 'manual';
  dev_max_pct: number;
  studio_universe: 'meme' | 'internet' | 'luxe' | 'space' | 'tech' | 'gaming';
  studio_tone: 'luxe' | 'minimal' | 'witty' | 'community';
  studio_lang: 'en' | 'fr';
  notify_email: boolean;
  notify_orders: boolean;
  extra: Record<string, unknown>;
  updated_at: string;
};

export type PrefsPatch = Partial<Omit<Preferences, 'user_id' | 'updated_at'>>;

export type Wallet = {
  id: string;
  user_id: string;
  address: string;
  chain: 'solana';
  label: string | null;
  is_primary: boolean;
  verified_at: string;
  created_at: string;
};

export type AuditEntry = {
  id: number;
  event: string;
  detail: Record<string, unknown>;
  created_at: string;
};
