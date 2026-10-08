-- TokenStudio : schéma principal. Chaque table est privée à son propriétaire (RLS).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------- profils ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique check (username ~ '^[A-Za-z0-9_]{3,24}$'),
  display_name text check (char_length(display_name) between 1 and 40),
  avatar_url text check (char_length(avatar_url) <= 500),
  bio text check (char_length(bio) <= 280),
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  timezone text not null default 'Europe/Paris' check (char_length(timezone) between 1 and 64),
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- préférences ----------
create table public.preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ui_theme text not null default 'or' check (ui_theme in ('or', 'platine', 'saphir', 'jade', 'cuivre', 'iris')),
  ui_depth text not null default 'profond' check (ui_depth in ('nuit', 'profond', 'doux')),
  sim_mode boolean not null default true,
  slippage_pct numeric(5,2) not null default 15 check (slippage_pct between 0.1 and 50),
  max_buy_sol numeric(12,4) not null default 1 check (max_buy_sol > 0 and max_buy_sol <= 100),
  priority text not null default 'fast' check (priority in ('eco', 'fast', 'turbo', 'manual')),
  dev_max_pct numeric(5,2) not null default 10 check (dev_max_pct between 0 and 100),
  studio_universe text not null default 'meme' check (studio_universe in ('meme', 'internet', 'luxe', 'space', 'tech', 'gaming')),
  studio_tone text not null default 'luxe' check (studio_tone in ('luxe', 'minimal', 'witty', 'community')),
  studio_lang text not null default 'en' check (studio_lang in ('en', 'fr')),
  notify_email boolean not null default false,
  notify_orders boolean not null default true,
  extra jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object' and pg_column_size(extra) < 8192),
  updated_at timestamptz not null default now()
);

-- ---------- wallets liés (adresses publiques uniquement, jamais de clé privée) ----------
create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null unique check (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  chain text not null default 'solana' check (chain = 'solana'),
  label text check (char_length(label) <= 32),
  is_primary boolean not null default false,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index wallets_user_idx on public.wallets (user_id);
create unique index wallets_one_primary on public.wallets (user_id) where is_primary;

-- ---------- brouillons de tokens ----------
create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text check (char_length(title) <= 64),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 65536),
  logo_path text check (char_length(logo_path) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index drafts_user_idx on public.drafts (user_id, updated_at desc);

-- ---------- tokens lancés ----------
create table public.tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mint text not null check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  name text not null check (char_length(name) between 1 and 32),
  symbol text not null check (symbol ~ '^[A-Za-z0-9]{1,10}$'),
  platform text not null default 'pump' check (platform in ('pump', 'other')),
  image_url text check (char_length(image_url) <= 500),
  description text check (char_length(description) <= 1000),
  twitter text check (char_length(twitter) <= 200),
  telegram text check (char_length(telegram) <= 200),
  website text check (char_length(website) <= 200),
  dev_sol numeric(14,6) check (dev_sol >= 0),
  signature text check (char_length(signature) <= 100),
  added_manually boolean not null default false,
  launched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, mint)
);
create index tokens_user_idx on public.tokens (user_id, created_at desc);

-- ---------- journal des opérations ----------
create table public.operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('create', 'buy', 'sell', 'fees')),
  status text not null check (status in ('ok', 'err')),
  sim boolean not null default true,
  mint text check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  symbol text check (char_length(symbol) <= 32),
  sol numeric(20,9),
  tokens numeric(30,6),
  estimated boolean not null default false,
  auto boolean not null default false,
  signature text check (char_length(signature) <= 100),
  error text check (char_length(error) <= 500),
  at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index operations_user_idx on public.operations (user_id, at desc);

-- ---------- ordres préparés ----------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mint text not null check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  symbol text check (char_length(symbol) <= 32),
  kind text not null check (kind in ('tp', 'sl', 'trail', 'mcap')),
  value numeric(20,6) not null,
  pct numeric(5,2) not null default 100 check (pct > 0 and pct <= 100),
  ref_price numeric(30,18) check (ref_price >= 0),
  active boolean not null default true,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and pg_column_size(state) < 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_user_idx on public.orders (user_id, active);

-- ---------- bot papier ----------
create table public.bot_strategies (
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id text not null check (strategy_id ~ '^[a-z0-9_-]{2,32}$'),
  name text not null check (char_length(name) between 1 and 40),
  enabled boolean not null default true,
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object' and pg_column_size(params) < 16384),
  updated_at timestamptz not null default now(),
  primary key (user_id, strategy_id)
);
create table public.bot_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id text not null check (char_length(strategy_id) <= 32),
  mint text not null check (char_length(mint) <= 44),
  symbol text check (char_length(symbol) <= 32),
  opened_at timestamptz not null,
  closed_at timestamptz not null,
  size_sol numeric(20,9) not null,
  proceeds_sol numeric(20,9) not null,
  pnl_sol numeric(20,9) not null,
  pnl_pct numeric(12,4),
  reason text check (char_length(reason) <= 120),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 8192)
);
create index bot_trades_user_idx on public.bot_trades (user_id, closed_at desc);

-- ---------- diffusion (référencement) ----------
create table public.distributions (
  user_id uuid not null references auth.users(id) on delete cascade,
  mint text not null check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  platform text not null check (platform ~ '^[a-z0-9_-]{2,32}$'),
  status text not null default 'sent' check (status in ('sent', 'accepted')),
  sent_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, mint, platform)
);

-- ---------- journal d'audit (écrit uniquement par le serveur) ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null check (char_length(event) <= 64),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_user_idx on public.audit_log (user_id, created_at desc);

-- ---------- RLS : chaque utilisateur ne voit et ne modifie que ses propres lignes ----------
alter table public.profiles enable row level security;
alter table public.preferences enable row level security;
alter table public.wallets enable row level security;
alter table public.drafts enable row level security;
alter table public.tokens enable row level security;
alter table public.operations enable row level security;
alter table public.orders enable row level security;
alter table public.bot_strategies enable row level security;
alter table public.bot_trades enable row level security;
alter table public.distributions enable row level security;
alter table public.audit_log enable row level security;

-- aucun accès anonyme
revoke all on public.profiles, public.preferences, public.wallets, public.drafts, public.tokens, public.operations,
  public.orders, public.bot_strategies, public.bot_trades, public.distributions, public.audit_log from anon;

-- profils et préférences : créés par le serveur à l'inscription, l'utilisateur lit et modifie les siens
create policy "profil : lecture" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profil : modification" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "préférences : lecture" on public.preferences for select to authenticated using ((select auth.uid()) = user_id);
create policy "préférences : modification" on public.preferences for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- wallets : ajoutés uniquement par le serveur après preuve de propriété ; l'utilisateur peut les lire, les renommer, les retirer
create policy "wallets : lecture" on public.wallets for select to authenticated using ((select auth.uid()) = user_id);
create policy "wallets : renommer" on public.wallets for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "wallets : retirer" on public.wallets for delete to authenticated using ((select auth.uid()) = user_id);
revoke insert on public.wallets from authenticated;
revoke update on public.wallets from authenticated;
grant update (label, is_primary) on public.wallets to authenticated;

-- données de travail : accès complet à ses propres lignes
do $$
declare t text;
begin
  foreach t in array array['drafts', 'tokens', 'operations', 'orders', 'bot_strategies', 'bot_trades', 'distributions'] loop
    execute format('create policy "%1$s : lecture" on public.%1$I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "%1$s : ajout" on public.%1$I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "%1$s : modification" on public.%1$I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "%1$s : suppression" on public.%1$I for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- audit : lecture seule pour l'utilisateur
create policy "audit : lecture" on public.audit_log for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.audit_log from authenticated;

-- l'identifiant d'un profil ne se change pas
revoke update on public.profiles from authenticated;
grant update (username, display_name, avatar_url, bio, locale, timezone, onboarded) on public.profiles to authenticated;
revoke insert, delete on public.profiles, public.preferences from authenticated;
revoke update (user_id) on public.preferences from authenticated;
