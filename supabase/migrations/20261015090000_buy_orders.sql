-- Achats programmés sur un token : conditions combinables (capitalisation, recul depuis le plus haut, élan des
-- acheteurs sur une fenêtre de temps), évaluées en temps réel par l'écoute continue (creator-stream) à chaque
-- transaction du token ; l'achat part avec le wallet rapide choisi, la stratégie de sortie est attachée à la confirmation.
-- Plusieurs ordres possibles sur un même token (achats échelonnés) ; chacun s'exécute une seule fois.

create table public.buy_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mint text not null check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  symbol text check (char_length(symbol) <= 32),
  creator text check (creator ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  wallet text not null check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  amount_sol numeric(12,4) not null check (amount_sol >= 0.001 and amount_sol <= 10),
  slippage numeric(5,2) not null default 15 check (slippage between 1 and 50),
  priority numeric(8,6) not null default 0.003 check (priority between 0.0001 and 0.01),
  -- conditions (toutes vraies) : mcap_below / mcap_above (dollars), dip (% depuis le plus haut),
  -- buys (achats des autres sur w secondes), buy_sol (SOL achetés par les autres sur w secondes)
  conds jsonb not null check (jsonb_typeof(conds) = 'array' and jsonb_array_length(conds) between 1 and 4 and pg_column_size(conds) < 2048),
  cancel_on_creator_sell boolean not null default true,
  expires_at timestamptz not null check (expires_at <= now() + interval '8 days'),
  exit_rules jsonb check (exit_rules is null or (jsonb_typeof(exit_rules) = 'array' and jsonb_array_length(exit_rules) between 1 and 8 and pg_column_size(exit_rules) < 8192)),
  exit_slippage numeric(5,2) not null default 25 check (exit_slippage between 1 and 50),
  status text not null default 'active' check (status in ('active', 'paused', 'firing', 'done', 'failed', 'expired', 'cancelled')),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and pg_column_size(state) < 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index buy_orders_user_idx on public.buy_orders (user_id, created_at desc);
create index buy_orders_active_idx on public.buy_orders (status) where status = 'active';
alter table public.buy_orders enable row level security;
create policy "achats programmés : lecture" on public.buy_orders for select to authenticated using (user_id = (select auth.uid()));
create policy "achats programmés : création" on public.buy_orders for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'active'
    and exists (select 1 from public.server_wallets w where w.user_id = (select auth.uid()) and w.address = wallet)
    and (select count(*) from public.buy_orders o where o.user_id = (select auth.uid()) and o.status in ('active', 'paused')) < 50);
create policy "achats programmés : modification" on public.buy_orders for update to authenticated
  using (user_id = (select auth.uid()) and status in ('active', 'paused'))
  with check (user_id = (select auth.uid()) and status in ('active', 'paused', 'cancelled')
    and exists (select 1 from public.server_wallets w where w.user_id = (select auth.uid()) and w.address = wallet));
create policy "achats programmés : suppression" on public.buy_orders for delete to authenticated using (user_id = (select auth.uid()) and status <> 'firing');
revoke all on public.buy_orders from anon;
grant select, insert, delete on public.buy_orders to authenticated;
grant update (wallet, amount_sol, slippage, priority, conds, cancel_on_creator_sell, expires_at, exit_rules, exit_slippage, status, updated_at) on public.buy_orders to authenticated;
create trigger buy_orders_touch before update on public.buy_orders for each row execute function private.creators_touch();
alter publication supabase_realtime add table public.buy_orders;

-- serveur : ordres actifs (les ordres échus passent à « expiré » au passage), avec la limite par achat du compte
create or replace function public.buy_orders_active()
returns table (id uuid, user_id uuid, mint text, symbol text, creator text, wallet text, amount_sol numeric, slippage numeric, priority numeric,
  conds jsonb, cancel_on_creator_sell boolean, expires_at timestamptz, exit_rules jsonb, exit_slippage numeric, state jsonb, created_at timestamptz, max_buy_sol numeric)
language plpgsql security definer set search_path = '' as $$
begin
  update public.buy_orders set status = 'expired' where status in ('active', 'paused') and expires_at < now();
  return query
  select o.id, o.user_id, o.mint, o.symbol, o.creator, o.wallet, o.amount_sol, o.slippage, o.priority, o.conds, o.cancel_on_creator_sell,
         o.expires_at, o.exit_rules, o.exit_slippage, o.state, o.created_at, coalesce(p.max_buy_sol, 1)
  from public.buy_orders o left join public.preferences p on p.user_id = o.user_id
  where o.status = 'active'
  order by o.created_at limit 500;
end $$;
-- prise d'un ordre pour exécution : une seule fois (plusieurs écoutes se chevauchent)
create or replace function public.buy_order_claim(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.buy_orders set status = 'firing', state = state || jsonb_build_object('fired_at', extract(epoch from now()) * 1000)
  where id = p_id and status = 'active' and expires_at > now();
  get diagnostics n = row_count; return n > 0;
end $$;
-- fin d'exécution (acheté, échec, annulé par la garde du créateur) ; un échec avant envoi peut rendre l'ordre actif
create or replace function public.buy_order_finish(p_id uuid, p_status text, p_state jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.buy_orders set status = p_status, state = state || p_state
  where id = p_id and status in ('active', 'firing') and p_status in ('active', 'done', 'failed', 'cancelled')
$$;
-- relevé du plus haut (recul depuis le plus haut), sans toucher un ordre en cours d'exécution
create or replace function public.buy_orders_mark(rows jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.buy_orders o set state = o.state || (r->'state')
  from jsonb_array_elements(rows) r
  where o.id = (r->>'id')::uuid and o.status = 'active'
$$;
do $$ declare f text; begin
  foreach f in array array['buy_orders_active()', 'buy_order_claim(uuid)', 'buy_order_finish(uuid,text,jsonb)', 'buy_orders_mark(jsonb)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;

-- l'écoute continue tourne aussi tant qu'un achat programmé est actif
select cron.alter_job(
  (select jobid from cron.job where jobname = 'creator-stream'),
  command := $$ select net.http_post(
       url := 'https://juuytckoiheivddkkrgk.supabase.co/functions/v1/creator-stream',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-watch-key', public.app_secret('watch_key')),
       body := '{}'::jsonb,
       timeout_milliseconds := 10000
     ) where exists (select 1 from public.creators where alerts) or exists (select 1 from public.snipes where enabled)
          or exists (select 1 from public.strategies where status = 'active') or exists (select 1 from public.buy_orders where status = 'active') $$
);
