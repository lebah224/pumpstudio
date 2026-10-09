-- Coffre-fort : conversions SOL ↔ USDT/USDC dans le wallet de l'utilisateur, règles automatiques,
-- adresses de destination (plateformes d'échange) et historique.
-- Les règles et les adresses ne s'écrivent que par la fonction serveur « vault » (contrôles, code de confirmation) :
-- l'utilisateur peut seulement les lire. L'historique peut aussi être complété par le navigateur (conversions signées
-- avec Phantom), pour son propre compte.

create table if not exists public.vault_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('surplus', 'profit', 'drop', 'schedule', 'send')),
  stable text not null default 'USDT' check (stable in ('USDT', 'USDC')),
  params jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  last_run_at timestamptz,
  last_result jsonb,
  next_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists vault_rules_user on public.vault_rules (user_id);
create index if not exists vault_rules_active on public.vault_rules (active) where active;

create table if not exists public.vault_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null check (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  label text not null default '' check (char_length(label) <= 32),
  created_at timestamptz not null default now(),
  unique (user_id, address)
);

create table if not exists public.vault_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('protect', 'release', 'send')),
  stable text not null check (stable in ('USDT', 'USDC', 'SOL')),
  sol numeric,
  stable_amount numeric,
  wallet text check (wallet is null or wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  dest text check (dest is null or dest ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  signature text check (signature is null or char_length(signature) <= 100),
  auto boolean not null default false,
  rule_id uuid references public.vault_rules(id) on delete set null,
  status text not null default 'ok' check (status in ('ok', 'err')),
  error text check (error is null or char_length(error) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists vault_moves_user on public.vault_moves (user_id, created_at desc);

alter table public.vault_rules enable row level security;
alter table public.vault_addresses enable row level security;
alter table public.vault_moves enable row level security;

create policy vault_rules_read on public.vault_rules for select to authenticated using ((select auth.uid()) = user_id);
create policy vault_addresses_read on public.vault_addresses for select to authenticated using ((select auth.uid()) = user_id);
create policy vault_moves_read on public.vault_moves for select to authenticated using ((select auth.uid()) = user_id);
-- conversions signées dans le navigateur (Phantom…) : jamais automatiques, toujours pour son propre compte
create policy vault_moves_insert on public.vault_moves for insert to authenticated with check ((select auth.uid()) = user_id and auto = false and rule_id is null);

revoke all on public.vault_rules, public.vault_addresses, public.vault_moves from anon;
grant select on public.vault_rules, public.vault_addresses to authenticated;
grant select, insert on public.vault_moves to authenticated;
