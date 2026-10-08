-- Vente automatique côté serveur : quand un ordre se déclenche et que le compte a un wallet rapide qui détient le token,
-- le serveur vend lui-même (même outil fermé). Un verrou garantit qu'un ordre n'est exécuté qu'une fois,
-- par l'onglet ouvert OU par le serveur.
alter table public.orders
  add column if not exists claimed_by text check (claimed_by in ('client', 'server')),
  add column if not exists claimed_at timestamptz;

-- un ordre réactivé redevient libre
create or replace function private.orders_unclaim() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.active and not old.active then new.claimed_by := null; new.claimed_at := null; end if;
  return new;
end $$;
create or replace trigger orders_unclaim before update on public.orders for each row execute function private.orders_unclaim();

-- l'onglet ouvert réserve l'exécution avant de vendre (false : déjà prise par le serveur)
create or replace function public.order_claim(p_client_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.orders set claimed_by = 'client', claimed_at = now()
  where user_id = auth.uid() and client_id = p_client_id and active and claimed_by is null;
  get diagnostics n = row_count;
  if n > 0 then return true; end if;
  -- ordre pas encore enregistré dans la base : rien ne peut l'exécuter ailleurs
  return not exists (select 1 from public.orders where user_id = auth.uid() and client_id = p_client_id);
end $$;
revoke all on function public.order_claim(text) from public, anon;
grant execute on function public.order_claim(text) to authenticated;

-- serveur : réserver, libérer, clore
create or replace function public.order_claim_srv(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.orders set claimed_by = 'server', claimed_at = now() where id = p_id and active and claimed_by is null;
  get diagnostics n = row_count; return n > 0;
end $$;
create or replace function public.order_release_srv(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.orders set claimed_by = null, claimed_at = null where id = p_id and claimed_by = 'server';
$$;
create or replace function public.order_done_srv(p_id uuid, p_state jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.orders set active = false, state = state || p_state where id = p_id;
$$;
revoke all on function public.order_claim_srv(uuid) from public, anon, authenticated;
revoke all on function public.order_release_srv(uuid) from public, anon, authenticated;
revoke all on function public.order_done_srv(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.order_claim_srv(uuid) to service_role;
grant execute on function public.order_release_srv(uuid) to service_role;
grant execute on function public.order_done_srv(uuid, jsonb) to service_role;

-- ordres à surveiller : alertes demandées, ou wallet rapide capable de vendre
-- (nouvelle version sous un autre nom : l'ancienne reste pour compatibilité)
create or replace function public.watch_orders_due2() returns table (
  order_id uuid, user_id uuid, mint text, symbol text, kind text, value numeric, pct numeric, ref_price numeric,
  state jsonb, peak numeric, armed boolean, notify boolean, server_address text, auto_exec boolean, client_id text
) language sql stable security definer set search_path = '' as $$
  select o.id, o.user_id, o.mint, o.symbol, o.kind, o.value, o.pct, o.ref_price, o.state, w.peak, coalesce(w.armed, false),
         p.notify_orders and exists (select 1 from public.push_subscriptions s where s.user_id = o.user_id),
         sw.address,
         coalesce((p.extra -> 'studio' ->> 'autoExec')::boolean, true),
         o.client_id
  from public.orders o
  join public.preferences p on p.user_id = o.user_id
  left join private.order_watch w on w.order_id = o.id
  left join public.server_wallets sw on sw.user_id = o.user_id
  where o.active and w.alerted_at is null and o.claimed_by is null
    and ((p.notify_orders and exists (select 1 from public.push_subscriptions s where s.user_id = o.user_id)) or sw.address is not null)
  order by o.created_at
  limit 2000
$$;
revoke all on function public.watch_orders_due2() from public, anon, authenticated;
grant execute on function public.watch_orders_due2() to service_role;
