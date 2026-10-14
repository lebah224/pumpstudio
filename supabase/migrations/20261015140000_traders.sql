-- Acheteurs suivis : wallets de traders observés en temps réel. Chaque achat ou vente d'un wallet suivi est capté par
-- le flux temps réel (creator-stream, même connexion que les créateurs), enregistré pour chaque compte qui le suit,
-- et notifié selon les réglages du compte (achats, ventes, montant minimum).

create table public.traders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null check (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  label text check (char_length(label) <= 32),
  note text check (char_length(note) <= 280),
  alerts boolean not null default true,          -- notification à chaque achat
  alert_sells boolean not null default false,    -- notification aussi aux ventes
  alert_min_sol numeric not null default 0 check (alert_min_sol >= 0 and alert_min_sol <= 1000),
  last_trade_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, address)
);
create index traders_address_idx on public.traders (address);
alter table public.traders enable row level security;
create policy "acheteurs : lecture" on public.traders for select to authenticated using (user_id = (select auth.uid()));
create policy "acheteurs : ajout" on public.traders for insert to authenticated
  with check (user_id = (select auth.uid()) and rls.own_count('traders') < 100);
create policy "acheteurs : modification" on public.traders for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "acheteurs : retrait" on public.traders for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.traders from anon;
grant select, insert, delete on public.traders to authenticated;
grant update (label, note, alerts, alert_sells, alert_min_sol, updated_at) on public.traders to authenticated;
create trigger traders_touch before update on public.traders for each row execute function private.creators_touch();

-- transactions captées (une par compte et par signature), gardées 7 jours
create table public.trader_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trader text not null,
  mint text not null check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  side text not null check (side in ('buy', 'sell')),
  sol numeric not null default 0,
  tokens numeric not null default 0,
  mcap_sol numeric,
  symbol text check (char_length(symbol) <= 32),
  name text check (char_length(name) <= 80),
  image text check (char_length(image) <= 300),
  sig text not null check (char_length(sig) <= 100),
  at timestamptz not null default now(),
  unique (user_id, sig)
);
create index trader_trades_user_idx on public.trader_trades (user_id, at desc);
create index trader_trades_at_idx on public.trader_trades (at);
alter table public.trader_trades enable row level security;
create policy "trades suivis : lecture" on public.trader_trades for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.trader_trades from anon;
grant select on public.trader_trades to authenticated;
alter publication supabase_realtime add table public.trader_trades;

-- plafond par compte : comptage hors règle (voir 20261015120000)
create or replace function rls.own_count(p_table text) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n bigint;
begin
  if uid is null then return 0; end if;
  case p_table
    when 'creators' then select count(*) into n from public.creators where user_id = uid;
    when 'traders' then select count(*) into n from public.traders where user_id = uid;
    when 'strategies' then select count(*) into n from public.strategies where user_id = uid and status in ('active', 'paused');
    when 'snipes' then select count(*) into n from public.snipes where user_id = uid;
    when 'buy_orders' then select count(*) into n from public.buy_orders where user_id = uid and status in ('active', 'paused');
    when 'push_subscriptions' then select count(*) into n from public.push_subscriptions where user_id = uid;
    else raise exception 'table inconnue';
  end case;
  return n;
end $$;

-- ne plus suivre un wallet efface ses transactions du compte
create or replace function private.traders_clear_trades() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.trader_trades where user_id = old.user_id and trader = old.address;
  return old;
end $$;
create trigger traders_clear_trades after delete on public.traders for each row execute function private.traders_clear_trades();

-- serveur : wallets à écouter
create or replace function public.traders_watched() returns table (address text)
language sql stable security definer set search_path = '' as $$
  select distinct address from public.traders
$$;

-- serveur : enregistrement d'une transaction pour chaque compte qui suit ce wallet ; renvoie les comptes à notifier
create or replace function public.trader_trade_record(p_trader text, p_mint text, p_side text, p_sol numeric, p_tokens numeric, p_mcap numeric,
  p_symbol text, p_name text, p_image text, p_sig text, p_at timestamptz)
returns table (r_user uuid, r_label text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with ins as (
    insert into public.trader_trades (user_id, trader, mint, side, sol, tokens, mcap_sol, symbol, name, image, sig, at)
    select t.user_id, p_trader, p_mint, p_side, coalesce(p_sol, 0), coalesce(p_tokens, 0), p_mcap, left(p_symbol, 32), left(p_name, 80), left(p_image, 300), left(p_sig, 100), p_at
    from public.traders t where t.address = p_trader
    on conflict (user_id, sig) do nothing
    returning trader_trades.user_id
  ), upd as (
    update public.traders t set last_trade_at = p_at
    where t.address = p_trader and t.user_id in (select ins.user_id from ins)
    returning t.user_id, t.label, t.alerts, t.alert_sells, t.alert_min_sol
  )
  select upd.user_id, upd.label from upd
  where (p_side = 'buy' and upd.alerts or p_side = 'sell' and upd.alert_sells) and coalesce(p_sol, 0) >= upd.alert_min_sol;
end $$;

-- ménage : transactions de plus de 7 jours
create or replace function public.trader_trades_purge() returns void
language sql security definer set search_path = '' as $$
  delete from public.trader_trades where at < now() - interval '7 days'
$$;

do $$
declare f text;
begin
  foreach f in array array['traders_watched()', 'trader_trade_record(text,text,text,numeric,numeric,numeric,text,text,text,text,timestamptz)', 'trader_trades_purge()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;

select cron.schedule('trader-trades-purge', '17 3 * * *', $$ select public.trader_trades_purge() $$);

-- l'écoute temps réel tourne aussi dès qu'un wallet est suivi
select cron.alter_job(
  (select jobid from cron.job where jobname = 'creator-stream'),
  command := $$ select net.http_post(
       url := 'https://juuytckoiheivddkkrgk.supabase.co/functions/v1/creator-stream',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-watch-key', public.app_secret('watch_key')),
       body := '{}'::jsonb,
       timeout_milliseconds := 10000
     ) where exists (select 1 from public.creators where alerts) or exists (select 1 from public.snipes where enabled)
          or exists (select 1 from public.strategies where status = 'active') or exists (select 1 from public.buy_orders where status = 'active')
          or exists (select 1 from public.traders) $$
);
