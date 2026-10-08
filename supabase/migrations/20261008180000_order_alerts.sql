-- Alertes d'ordres par notification push.
-- Le serveur surveille les prix des ordres synchronisés et prévient l'utilisateur quand une condition est atteinte.
-- Il n'exécute jamais rien : aucune clé, aucune transaction, seulement une notification.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------- abonnements push (un par navigateur ou appareil) ----------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) < 1000),
  p256dh text not null check (char_length(p256dh) between 40 and 200),
  auth text not null check (char_length(auth) between 10 and 100),
  label text check (char_length(label) <= 60),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "push : lecture de mes appareils" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "push : ajout d'un appareil" on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select count(*) from public.push_subscriptions s where s.user_id = (select auth.uid())) < 10);
create policy "push : retrait de mes appareils" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
revoke update on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;

-- ---------- suivi serveur des ordres (plus haut atteint, alerte déjà envoyée) ----------
create table private.order_watch (
  order_id uuid primary key references public.orders(id) on delete cascade,
  peak numeric(30,18),
  armed boolean not null default false,
  alerted_at timestamptz,
  alerted_price numeric(30,18),
  updated_at timestamptz not null default now()
);
revoke all on private.order_watch from public, anon, authenticated;

-- ---------- secrets du serveur (clé VAPID privée, clé de la tâche planifiée), rangés dans Vault ----------
create or replace function public.app_secret(n text) returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = n limit 1
$$;
revoke all on function public.app_secret(text) from public, anon, authenticated;
grant execute on function public.app_secret(text) to service_role;

-- ordres à surveiller : actifs, non encore signalés, d'un compte qui veut des alertes et a au moins un appareil abonné
create or replace function public.watch_orders_due() returns table (
  order_id uuid, user_id uuid, mint text, symbol text, kind text, value numeric, pct numeric, ref_price numeric,
  state jsonb, peak numeric, armed boolean
) language sql stable security definer set search_path = '' as $$
  select o.id, o.user_id, o.mint, o.symbol, o.kind, o.value, o.pct, o.ref_price, o.state, w.peak, coalesce(w.armed, false)
  from public.orders o
  join public.preferences p on p.user_id = o.user_id and p.notify_orders
  left join private.order_watch w on w.order_id = o.id
  where o.active and w.alerted_at is null
    and exists (select 1 from public.push_subscriptions s where s.user_id = o.user_id)
  order by o.created_at
  limit 2000
$$;
revoke all on function public.watch_orders_due() from public, anon, authenticated;
grant execute on function public.watch_orders_due() to service_role;

create or replace function public.watch_orders_save(rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.order_watch (order_id, peak, armed, alerted_at, alerted_price, updated_at)
  select (r->>'order_id')::uuid, (r->>'peak')::numeric, coalesce((r->>'armed')::boolean, false),
         case when (r->>'alerted')::boolean then now() end, (r->>'price')::numeric, now()
  from jsonb_array_elements(rows) r
  on conflict (order_id) do update set
    peak = excluded.peak, armed = excluded.armed,
    alerted_at = coalesce(private.order_watch.alerted_at, excluded.alerted_at),
    alerted_price = coalesce(excluded.alerted_price, private.order_watch.alerted_price),
    updated_at = now();
end $$;
revoke all on function public.watch_orders_save(jsonb) from public, anon, authenticated;
grant execute on function public.watch_orders_save(jsonb) to service_role;

-- un ordre réactivé ou modifié par l'utilisateur peut de nouveau être signalé
create or replace function private.reset_order_watch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.active and (not old.active or new.value is distinct from old.value or new.ref_price is distinct from old.ref_price or new.kind is distinct from old.kind) then
    delete from private.order_watch where order_id = new.id;
  end if;
  return new;
end $$;
create trigger orders_reset_watch after update on public.orders for each row execute function private.reset_order_watch();
