-- Achat automatique au lancement d'un créateur suivi : une règle par créateur et par compte.
-- L'écoute continue (creator-stream) achète avec le wallet rapide choisi dès l'avis de création, si les filtres passent,
-- puis attache la stratégie de sortie choisie une fois l'achat confirmé. Chaque tentative est notée dans snipe_runs.

create table public.snipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator text not null check (creator ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  wallet text not null check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  enabled boolean not null default true,
  mode text not null default 'next' check (mode in ('next', 'every')),
  amount_sol numeric(12,4) not null check (amount_sol >= 0.001 and amount_sol <= 10),
  slippage numeric(5,2) not null default 30 check (slippage between 1 and 50),
  priority numeric(8,6) not null default 0.003 check (priority between 0.0001 and 0.01),
  max_per_day integer not null default 3 check (max_per_day between 1 and 50),
  -- filtres lus dans l'avis de création : dev_min / dev_max (SOL achetés par le créateur), dev_pct (part max en %),
  -- mcap_max (capitalisation max en SOL au moment de l'achat), gap_min (minutes min depuis son lancement précédent)
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) < 1024),
  exit_rules jsonb check (exit_rules is null or (jsonb_typeof(exit_rules) = 'array' and jsonb_array_length(exit_rules) between 1 and 8 and pg_column_size(exit_rules) < 8192)),
  exit_slippage numeric(5,2) not null default 25 check (exit_slippage between 1 and 50),
  fired_count integer not null default 0,
  last_fired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, creator)
);
create index snipes_enabled_idx on public.snipes (creator) where enabled;
alter table public.snipes enable row level security;
create policy "achats auto : lecture" on public.snipes for select to authenticated using (user_id = (select auth.uid()));
create policy "achats auto : création" on public.snipes for insert to authenticated
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.server_wallets w where w.user_id = (select auth.uid()) and w.address = wallet)
    and (select count(*) from public.snipes s where s.user_id = (select auth.uid())) < 50);
create policy "achats auto : modification" on public.snipes for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.server_wallets w where w.user_id = (select auth.uid()) and w.address = wallet));
create policy "achats auto : suppression" on public.snipes for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.snipes from anon;
grant select, insert, delete on public.snipes to authenticated;
grant update (wallet, enabled, mode, amount_sol, slippage, priority, max_per_day, filters, exit_rules, exit_slippage, updated_at) on public.snipes to authenticated;
create trigger snipes_touch before update on public.snipes for each row execute function private.creators_touch();
alter publication supabase_realtime add table public.snipes;

-- journal des tentatives (une par règle et par token)
create table public.snipe_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snipe_id uuid references public.snipes(id) on delete set null,
  creator text not null,
  mint text not null check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  symbol text check (char_length(symbol) <= 32),
  wallet text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'bought', 'failed', 'skipped')),
  reason text check (char_length(reason) <= 200),
  amount_sol numeric(12,4),
  sol numeric(20,9),
  tokens numeric(30,6),
  signature text check (char_length(signature) <= 100),
  send_ms integer,
  strategy_id uuid references public.strategies(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snipe_id, mint)
);
create index snipe_runs_user_idx on public.snipe_runs (user_id, created_at desc);
alter table public.snipe_runs enable row level security;
create policy "achats auto : journal" on public.snipe_runs for select to authenticated using (user_id = (select auth.uid()));
create policy "achats auto : effacement du journal" on public.snipe_runs for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.snipe_runs from anon;
grant select, delete on public.snipe_runs to authenticated;
alter publication supabase_realtime add table public.snipe_runs;

-- l'écoute suit aussi les créateurs qui ont un achat automatique actif
create or replace function public.creators_watched() returns table (address text)
language sql stable security definer set search_path = '' as $$
  select address from public.creators where alerts
  union
  select creator from public.snipes where enabled
$$;

-- règles actives, avec la limite par achat du compte et le dernier lancement connu du créateur
create or replace function public.snipes_active()
returns table (id uuid, user_id uuid, creator text, wallet text, mode text, amount_sol numeric, slippage numeric, priority numeric,
  max_per_day integer, filters jsonb, exit_rules jsonb, exit_slippage numeric, max_buy_sol numeric, prev_launch timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.user_id, s.creator, s.wallet, s.mode, s.amount_sol, s.slippage, s.priority, s.max_per_day, s.filters, s.exit_rules, s.exit_slippage,
         coalesce(p.max_buy_sol, 1),
         (select max(l.launched_at) from public.creator_launches l where l.creator = s.creator)
  from public.snipes s left join public.preferences p on p.user_id = s.user_id
  where s.enabled
$$;

-- prise d'une règle pour un token : une seule fois (plusieurs écoutes se chevauchent), dans la limite du jour ;
-- une règle « prochain lancement » se coupe aussitôt
create or replace function public.snipe_claim(p_id uuid, p_mint text, p_symbol text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.snipes; n int; r uuid;
begin
  select * into s from public.snipes where id = p_id for update;
  if not found or not s.enabled then return null; end if;
  select count(*) into n from public.snipe_runs where snipe_id = p_id and status not in ('failed', 'skipped') and created_at > now() - interval '24 hours';
  if n >= s.max_per_day then return null; end if;
  insert into public.snipe_runs (user_id, snipe_id, creator, mint, symbol, wallet, amount_sol)
  values (s.user_id, p_id, s.creator, p_mint, left(p_symbol, 32), s.wallet, s.amount_sol)
  on conflict (snipe_id, mint) do nothing returning id into r;
  if r is null then return null; end if;
  update public.snipes set fired_count = fired_count + 1, last_fired_at = now(), enabled = (mode = 'every') where id = p_id;
  return r;
end $$;

-- lancement écarté par un filtre : noté (sans compter dans la limite du jour, sans couper la règle)
create or replace function public.snipe_skip(p_id uuid, p_mint text, p_symbol text, p_reason text)
returns void
language sql security definer set search_path = '' as $$
  insert into public.snipe_runs (user_id, snipe_id, creator, mint, symbol, wallet, amount_sol, status, reason)
  select s.user_id, s.id, s.creator, p_mint, left(p_symbol, 32), s.wallet, s.amount_sol, 'skipped', left(p_reason, 200)
  from public.snipes s where s.id = p_id
  on conflict (snipe_id, mint) do nothing
$$;

create or replace function public.snipe_run_set(p_id uuid, p jsonb)
returns void
language sql security definer set search_path = '' as $$
  update public.snipe_runs set
    status = coalesce(p->>'status', status),
    reason = coalesce(left(p->>'reason', 200), reason),
    sol = coalesce((p->>'sol')::numeric, sol),
    tokens = coalesce((p->>'tokens')::numeric, tokens),
    signature = coalesce(left(p->>'signature', 100), signature),
    send_ms = coalesce((p->>'send_ms')::int, send_ms),
    strategy_id = coalesce((p->>'strategy_id')::uuid, strategy_id),
    updated_at = now()
  where id = p_id
$$;

do $$ declare f text; begin
  foreach f in array array['creators_watched()', 'snipes_active()', 'snipe_claim(uuid,text,text)', 'snipe_skip(uuid,text,text,text)', 'snipe_run_set(uuid,jsonb)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;

-- l'écoute continue tourne dès qu'il y a une alerte ou un achat automatique actif
select cron.alter_job(
  (select jobid from cron.job where jobname = 'creator-stream'),
  command := $$ select net.http_post(
       url := 'https://juuytckoiheivddkkrgk.supabase.co/functions/v1/creator-stream',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-watch-key', public.app_secret('watch_key')),
       body := '{}'::jsonb,
       timeout_milliseconds := 10000
     ) where exists (select 1 from public.creators where alerts) or exists (select 1 from public.snipes where enabled) $$
);
