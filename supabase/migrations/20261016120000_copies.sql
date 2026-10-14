-- Copie des achats d'un acheteur suivi : une règle par wallet copié et par compte.
-- L'écoute continue (creator-stream) voit chaque achat confirmé du wallet copié et achète aussitôt avec le wallet rapide
-- choisi (un seul achat par token), si les filtres passent ; stratégie de sortie attachée à la confirmation ;
-- s'il revend, la position copiée peut être revendue en entier dans la foulée. Chaque tentative est notée dans copy_runs.

create table public.copies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trader text not null check (trader ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  wallet text not null check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  enabled boolean not null default true,
  amount_sol numeric(12,4) not null check (amount_sol >= 0.001 and amount_sol <= 10),
  slippage numeric(5,2) not null default 25 check (slippage between 1 and 50),
  priority numeric(8,6) not null default 0.003 check (priority between 0.0001 and 0.01),
  max_per_day integer not null default 5 check (max_per_day between 1 and 50),
  -- filtres lus dans l'achat copié : min_sol / max_sol (SOL qu'il engage), mcap_max (capitalisation max en SOL)
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) < 1024),
  copy_sells boolean not null default true,
  exit_rules jsonb check (exit_rules is null or (jsonb_typeof(exit_rules) = 'array' and jsonb_array_length(exit_rules) between 1 and 8 and pg_column_size(exit_rules) < 8192)),
  exit_slippage numeric(5,2) not null default 25 check (exit_slippage between 1 and 50),
  fired_count integer not null default 0,
  last_fired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, trader)
);
create index copies_enabled_idx on public.copies (trader) where enabled;
alter table public.copies enable row level security;
create policy "copies : lecture" on public.copies for select to authenticated using (user_id = (select auth.uid()));
create policy "copies : création" on public.copies for insert to authenticated
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.server_wallets w where w.user_id = (select auth.uid()) and w.address = wallet)
    and wallet <> trader
    and rls.own_count('copies') < 30);
create policy "copies : modification" on public.copies for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.server_wallets w where w.user_id = (select auth.uid()) and w.address = wallet) and wallet <> trader);
create policy "copies : suppression" on public.copies for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.copies from anon;
grant select, insert, delete on public.copies to authenticated;
grant update (wallet, enabled, amount_sol, slippage, priority, max_per_day, filters, copy_sells, exit_rules, exit_slippage, updated_at) on public.copies to authenticated;
create trigger copies_touch before update on public.copies for each row execute function private.creators_touch();
alter publication supabase_realtime add table public.copies;

-- plafond par compte, compté hors de la règle elle-même (voir 20261015120000_fix_rls_recursion.sql)
create or replace function rls.own_count(p_table text) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n bigint;
begin
  if uid is null then return 0; end if;
  case p_table
    when 'creators' then select count(*) into n from public.creators where user_id = uid;
    when 'strategies' then select count(*) into n from public.strategies where user_id = uid and status in ('active', 'paused');
    when 'snipes' then select count(*) into n from public.snipes where user_id = uid;
    when 'buy_orders' then select count(*) into n from public.buy_orders where user_id = uid and status in ('active', 'paused');
    when 'push_subscriptions' then select count(*) into n from public.push_subscriptions where user_id = uid;
    when 'traders' then select count(*) into n from public.traders where user_id = uid;
    when 'copies' then select count(*) into n from public.copies where user_id = uid;
    else raise exception 'table inconnue';
  end case;
  return n;
end $$;

-- journal des tentatives (une par règle et par token)
create table public.copy_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  copy_id uuid references public.copies(id) on delete set null,
  trader text not null,
  mint text not null check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  symbol text check (char_length(symbol) <= 32),
  wallet text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'bought', 'failed', 'skipped', 'sold')),
  reason text check (char_length(reason) <= 200),
  trader_sol numeric(20,9),
  amount_sol numeric(12,4),
  sol numeric(20,9),
  tokens numeric(30,6),
  signature text check (char_length(signature) <= 100),
  send_ms integer,
  strategy_id uuid references public.strategies(id) on delete set null,
  sold_sol numeric(20,9),
  sell_signature text check (char_length(sell_signature) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (copy_id, mint)
);
create index copy_runs_user_idx on public.copy_runs (user_id, created_at desc);
create index copy_runs_open_idx on public.copy_runs (trader, mint) where status = 'bought';
alter table public.copy_runs enable row level security;
create policy "copies : journal" on public.copy_runs for select to authenticated using (user_id = (select auth.uid()));
create policy "copies : effacement du journal" on public.copy_runs for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.copy_runs from anon;
grant select, delete on public.copy_runs to authenticated;
alter publication supabase_realtime add table public.copy_runs;

-- l'écoute suit aussi les wallets copiés
create or replace function public.traders_watched() returns table (address text)
language sql stable security definer set search_path = '' as $$
  select address from public.traders
  union
  select trader from public.copies where enabled
$$;

-- règles actives, avec la limite par achat du compte
create or replace function public.copies_active()
returns table (id uuid, user_id uuid, trader text, wallet text, amount_sol numeric, slippage numeric, priority numeric, max_per_day integer,
  filters jsonb, copy_sells boolean, exit_rules jsonb, exit_slippage numeric, max_buy_sol numeric)
language sql stable security definer set search_path = '' as $$
  select c.id, c.user_id, c.trader, c.wallet, c.amount_sol, c.slippage, c.priority, c.max_per_day, c.filters, c.copy_sells, c.exit_rules, c.exit_slippage,
         coalesce(p.max_buy_sol, 1)
  from public.copies c left join public.preferences p on p.user_id = c.user_id
  where c.enabled
$$;

-- prise d'une règle pour un token : une seule fois (plusieurs écoutes se chevauchent), dans la limite du jour
create or replace function public.copy_claim(p_id uuid, p_mint text, p_symbol text, p_trader_sol numeric)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.copies; n int; r uuid;
begin
  select * into c from public.copies where id = p_id for update;
  if not found or not c.enabled then return null; end if;
  select count(*) into n from public.copy_runs where copy_id = p_id and status not in ('failed', 'skipped') and created_at > now() - interval '24 hours';
  if n >= c.max_per_day then return null; end if;
  insert into public.copy_runs (user_id, copy_id, trader, mint, symbol, wallet, trader_sol, amount_sol)
  values (c.user_id, p_id, c.trader, p_mint, left(p_symbol, 32), c.wallet, p_trader_sol, c.amount_sol)
  on conflict (copy_id, mint) do nothing returning id into r;
  if r is null then return null; end if;
  update public.copies set fired_count = fired_count + 1, last_fired_at = now() where id = p_id;
  return r;
end $$;

-- achat écarté par un filtre : noté (sans compter dans la limite du jour)
create or replace function public.copy_skip(p_id uuid, p_mint text, p_symbol text, p_trader_sol numeric, p_reason text)
returns void
language sql security definer set search_path = '' as $$
  insert into public.copy_runs (user_id, copy_id, trader, mint, symbol, wallet, trader_sol, amount_sol, status, reason)
  select c.user_id, c.id, c.trader, p_mint, left(p_symbol, 32), c.wallet, p_trader_sol, c.amount_sol, 'skipped', left(p_reason, 200)
  from public.copies c where c.id = p_id
  on conflict (copy_id, mint) do nothing
$$;

create or replace function public.copy_run_set(p_id uuid, p jsonb)
returns void
language sql security definer set search_path = '' as $$
  update public.copy_runs set
    status = coalesce(p->>'status', status),
    reason = coalesce(left(p->>'reason', 200), reason),
    sol = coalesce((p->>'sol')::numeric, sol),
    tokens = coalesce((p->>'tokens')::numeric, tokens),
    signature = coalesce(left(p->>'signature', 100), signature),
    send_ms = coalesce((p->>'send_ms')::int, send_ms),
    strategy_id = coalesce((p->>'strategy_id')::uuid, strategy_id),
    sold_sol = coalesce((p->>'sold_sol')::numeric, sold_sol),
    sell_signature = coalesce(left(p->>'sell_signature', 100), sell_signature),
    updated_at = now()
  where id = p_id
$$;

-- vente du wallet copié : positions copiées encore ouvertes sur ce token, à revendre (prises une seule fois)
create or replace function public.copy_sell_claim(p_trader text, p_mint text)
returns table (r_id uuid, r_user uuid, r_wallet text, r_symbol text, r_slippage numeric, r_priority numeric, r_strategy uuid, r_sol numeric)
language sql security definer set search_path = '' as $$
  update public.copy_runs r set status = 'sold', reason = 'Revente lancée : le wallet copié a vendu', updated_at = now()
  from public.copies c
  where r.copy_id = c.id and c.copy_sells and r.trader = p_trader and r.mint = p_mint and r.status = 'bought'
  returning r.id, r.user_id, r.wallet, r.symbol, c.exit_slippage, c.priority, r.strategy_id, r.sol
$$;

do $$ declare f text; begin
  foreach f in array array['copies_active()', 'copy_claim(uuid,text,text,numeric)', 'copy_skip(uuid,text,text,numeric,text)', 'copy_run_set(uuid,jsonb)', 'copy_sell_claim(text,text)', 'traders_watched()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;

-- l'écoute temps réel tourne aussi dès qu'une copie est active
select cron.alter_job(
  (select jobid from cron.job where jobname = 'creator-stream'),
  command := $$ select net.http_post(
       url := 'https://juuytckoiheivddkkrgk.supabase.co/functions/v1/creator-stream',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-watch-key', public.app_secret('watch_key')),
       body := '{}'::jsonb,
       timeout_milliseconds := 10000
     ) where exists (select 1 from public.creators where alerts) or exists (select 1 from public.snipes where enabled)
          or exists (select 1 from public.strategies where status = 'active') or exists (select 1 from public.buy_orders where status = 'active')
          or exists (select 1 from public.traders) or exists (select 1 from public.copies where enabled) $$
);
