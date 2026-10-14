-- Stratégies de sortie : des règles de vente posées sur une position, appliquées par le serveur même outil fermé.
-- Chaque règle réunit une ou plusieurs conditions (toutes doivent être vraies) et vend un pourcentage de ce qui reste.
-- Les règles sont indépendantes : la première remplie s'exécute, chacune une seule fois.
-- Conditions : gain, perte, recul depuis le plus haut, achats ou ventes des autres après notre achat, SOL vendus par
-- les autres, vente du créateur, durée, capitalisation.

create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mint text not null check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  symbol text check (char_length(symbol) <= 32),
  name text check (char_length(name) <= 40),
  wallet text check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  creator text check (creator ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  entry_at timestamptz not null default now(),
  entry_price numeric(30,18) check (entry_price > 0),
  entry_tokens numeric(30,6) check (entry_tokens >= 0),
  entry_sol numeric(20,9) check (entry_sol >= 0),
  slippage numeric(5,2) not null default 25 check (slippage between 1 and 50),
  rules jsonb not null check (jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) between 1 and 8 and pg_column_size(rules) < 8192),
  status text not null default 'active' check (status in ('active', 'paused', 'done', 'error')),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and pg_column_size(state) < 16384),
  busy_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index strategies_user_idx on public.strategies (user_id, status);
create index strategies_active_idx on public.strategies (status) where status = 'active';
-- une seule stratégie active par token et par compte
create unique index strategies_one_active on public.strategies (user_id, mint) where status in ('active', 'paused');

alter table public.strategies enable row level security;
create policy "stratégies : lecture" on public.strategies for select to authenticated using (user_id = (select auth.uid()));
create policy "stratégies : création" on public.strategies for insert to authenticated
  with check (user_id = (select auth.uid()) and status in ('active', 'paused')
    and (select count(*) from public.strategies s where s.user_id = (select auth.uid()) and s.status in ('active', 'paused')) < 50);
create policy "stratégies : modification" on public.strategies for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and status in ('active', 'paused', 'done'));
create policy "stratégies : suppression" on public.strategies for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.strategies from anon;
grant select, insert, delete on public.strategies to authenticated;
-- le navigateur ne modifie que le réglage ; l'état d'exécution appartient au serveur
grant update (name, rules, slippage, status, entry_price, entry_tokens, entry_at, updated_at) on public.strategies to authenticated;

create or replace function private.strategies_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  -- réactivée après une pause ou une erreur : on repart d'un état d'exécution propre (règles déjà exécutées gardées)
  if new.status = 'active' and old.status <> 'active' then new.busy_at := null; end if;
  return new;
end $$;
create trigger strategies_touch before update on public.strategies for each row execute function private.strategies_touch();

-- temps réel : l'onglet ouvert voit les ventes exécutées par le serveur
alter publication supabase_realtime add table public.strategies;

/* ---------- serveur : sélection, verrou, enregistrement (rôle service uniquement) ---------- */
-- stratégies actives libres (un verrou de plus de 2 minutes est considéré comme abandonné)
create or replace function public.strategies_due() returns setof public.strategies
language sql stable security definer set search_path = '' as $$
  select * from public.strategies
  where status = 'active' and (busy_at is null or busy_at < now() - interval '2 minutes')
  order by updated_at limit 500
$$;
create or replace function public.strategy_claim(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.strategies set busy_at = now()
  where id = p_id and status = 'active' and (busy_at is null or busy_at < now() - interval '2 minutes');
  get diagnostics n = row_count; return n > 0;
end $$;
-- fin d'un passage : état fusionné, statut éventuel, verrou levé
create or replace function public.strategy_save(p_id uuid, p_state jsonb, p_status text default null) returns void
language sql security definer set search_path = '' as $$
  update public.strategies set state = state || p_state, status = coalesce(p_status, status), busy_at = null where id = p_id
$$;
-- relevé sans verrou (plus haut atteint, compteurs) : seulement si personne n'exécute
create or replace function public.strategies_mark(rows jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.strategies s set state = s.state || (r->'state')
  from jsonb_array_elements(rows) r
  where s.id = (r->>'id')::uuid and s.busy_at is null
$$;
-- un seul passage de surveillance à la fois
create table private.strategy_lease (id int primary key default 1 check (id = 1), until timestamptz not null default now());
insert into private.strategy_lease default values;
revoke all on private.strategy_lease from public, anon, authenticated;
create or replace function public.strategy_lease(p_seconds int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update private.strategy_lease set until = now() + make_interval(secs => p_seconds) where id = 1 and until < now();
  get diagnostics n = row_count; return n > 0;
end $$;
create or replace function public.strategy_unlease() returns void
language sql security definer set search_path = '' as $$ update private.strategy_lease set until = now() where id = 1 $$;

do $$ declare f text; begin
  foreach f in array array['strategies_due()', 'strategy_claim(uuid)', 'strategy_save(uuid,jsonb,text)', 'strategies_mark(jsonb)', 'strategy_lease(integer)', 'strategy_unlease()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;

-- surveillance toutes les 5 secondes (la fonction lit la clé dans Vault à chaque appel)
select cron.schedule(
  'strategy-watch',
  '5 seconds',
  $$ select net.http_post(
       url := 'https://juuytckoiheivddkkrgk.supabase.co/functions/v1/strategy-watch',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-watch-key', public.app_secret('watch_key')),
       body := '{}'::jsonb,
       timeout_milliseconds := 60000
     ) where exists (select 1 from public.strategies where status = 'active') $$
);
