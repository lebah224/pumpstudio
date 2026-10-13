-- Plusieurs wallets rapides par compte, numérotés dans l'ordre de création (n°1, n°2…), protégés par un seul
-- mot de passe pour le compte. Le wallet existant devient le n°1 ; son mot de passe devient celui du compte.

create table private.server_wallet_pw (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pw_hash text not null, pw_salt text not null, pw_iter integer not null,
  fails integer not null default 0,
  locked_until timestamptz
);
revoke all on private.server_wallet_pw from public, anon, authenticated;
insert into private.server_wallet_pw (user_id, pw_hash, pw_salt, pw_iter, fails, locked_until)
  select user_id, pw_hash, pw_salt, pw_iter, fails, locked_until from private.server_wallet_keys
  on conflict (user_id) do nothing;

-- numéro du wallet dans le compte
alter table public.server_wallets add column num integer;
update public.server_wallets set num = 1 where num is null;
alter table public.server_wallets alter column num set not null;

-- clés et dépenses rattachées à l'adresse du wallet (et non plus au compte)
alter table private.server_wallet_keys add column address text;
update private.server_wallet_keys k set address = w.address from public.server_wallets w where w.user_id = k.user_id;
alter table private.server_wallet_spend add column address text;
update private.server_wallet_spend s set address = w.address from public.server_wallets w where w.user_id = s.user_id;

alter table private.server_wallet_keys drop constraint server_wallet_keys_user_id_fkey;
alter table private.server_wallet_spend drop constraint server_wallet_spend_user_id_fkey;
alter table private.server_wallet_keys drop constraint server_wallet_keys_pkey;
alter table private.server_wallet_spend drop constraint server_wallet_spend_pkey;
alter table public.server_wallets drop constraint server_wallets_pkey;
alter table public.server_wallets add constraint server_wallets_pkey primary key (address);
alter table public.server_wallets add constraint server_wallets_user_num unique (user_id, num);

alter table private.server_wallet_keys alter column address set not null;
alter table private.server_wallet_keys add constraint server_wallet_keys_pkey primary key (address);
alter table private.server_wallet_keys add constraint server_wallet_keys_address_fkey foreign key (address) references public.server_wallets(address) on delete cascade;
alter table private.server_wallet_keys alter column pw_hash drop not null, alter column pw_salt drop not null, alter column pw_iter drop not null;

alter table private.server_wallet_spend alter column address set not null;
alter table private.server_wallet_spend add constraint server_wallet_spend_pkey primary key (address, day);
alter table private.server_wallet_spend add constraint server_wallet_spend_address_fkey foreign key (address) references public.server_wallets(address) on delete cascade;

/* ---------- fonctions pour le serveur (rôle service uniquement) ---------- */
create or replace function public.sw_list(uid uuid) returns table (address text, num integer, daily_cap_sol numeric, alert_balance_sol numeric, spent_today numeric, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select w.address, w.num, w.daily_cap_sol, w.alert_balance_sol,
         coalesce((select s.spent_sol from private.server_wallet_spend s where s.address = w.address and s.day = (now() at time zone 'utc')::date), 0), w.created_at
  from public.server_wallets w where w.user_id = uid order by w.num
$$;

create or replace function public.sw_get(uid uuid, addr text) returns table (address text, num integer, daily_cap_sol numeric, alert_balance_sol numeric, enc text, iv text, spent_today numeric)
language sql stable security definer set search_path = '' as $$
  select w.address, w.num, w.daily_cap_sol, w.alert_balance_sol, k.enc, k.iv,
         coalesce((select s.spent_sol from private.server_wallet_spend s where s.address = w.address and s.day = (now() at time zone 'utc')::date), 0)
  from public.server_wallets w join private.server_wallet_keys k on k.address = w.address
  where w.user_id = uid and w.address = addr
$$;

create or replace function public.sw_pw_get(uid uuid) returns table (pw_hash text, pw_salt text, pw_iter integer, fails integer, locked_until timestamptz)
language sql stable security definer set search_path = '' as $$
  select pw_hash, pw_salt, pw_iter, fails, locked_until from private.server_wallet_pw where user_id = uid
$$;

create or replace function public.sw_pw_set(uid uuid, p_hash text, p_salt text, p_iter integer) returns void
language sql security definer set search_path = '' as $$
  insert into private.server_wallet_pw (user_id, pw_hash, pw_salt, pw_iter) values (uid, p_hash, p_salt, p_iter)
  on conflict (user_id) do update set pw_hash = excluded.pw_hash, pw_salt = excluded.pw_salt, pw_iter = excluded.pw_iter, fails = 0, locked_until = null
$$;

-- 5 mots de passe faux = blocage 15 minutes
create or replace function public.sw_pw_result(uid uuid, ok boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if ok then update private.server_wallet_pw set fails = 0, locked_until = null where user_id = uid;
  else
    update private.server_wallet_pw set fails = fails + 1,
      locked_until = case when fails + 1 >= 5 then now() + interval '15 minutes' else locked_until end
    where user_id = uid;
    insert into public.audit_log (user_id, event, detail) values (uid, 'server_wallet_bad_password', '{}'::jsonb);
  end if;
end $$;

-- nouveau wallet : numéro suivant du compte (20 au plus)
create or replace function public.sw_create(uid uuid, addr text, p_enc text, p_iv text) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtext('sw:' || uid::text));
  if (select count(*) from public.server_wallets where user_id = uid) >= 20 then raise exception 'Vous avez déjà 20 wallets rapides.'; end if;
  select coalesce(max(num), 0) + 1 into n from public.server_wallets where user_id = uid;
  insert into public.server_wallets (user_id, address, num) values (uid, addr, n);
  insert into private.server_wallet_keys (user_id, address, enc, iv) values (uid, addr, p_enc, p_iv);
  insert into public.audit_log (user_id, event, detail) values (uid, 'server_wallet_created', jsonb_build_object('address', addr, 'num', n));
  return n;
end $$;

-- réserve un montant dans le plafond du jour du wallet, de façon atomique ; refuse au-delà
create or replace function public.sw_reserve(uid uuid, addr text, sol numeric) returns numeric
language plpgsql security definer set search_path = '' as $$
declare cap numeric; cur numeric; d date := (now() at time zone 'utc')::date;
begin
  select daily_cap_sol into cap from public.server_wallets where user_id = uid and address = addr for update;
  if cap is null then raise exception 'Wallet rapide introuvable'; end if;
  insert into private.server_wallet_spend (user_id, address, day) values (uid, addr, d) on conflict do nothing;
  select spent_sol into cur from private.server_wallet_spend where address = addr and day = d for update;
  if cur + sol > cap then raise exception 'Plafond journalier atteint (% SOL sur % SOL)', round(cur, 3), cap; end if;
  update private.server_wallet_spend set spent_sol = spent_sol + sol where address = addr and day = d;
  update public.server_wallets set last_tx_at = now() where address = addr;
  return cap - cur - sol;
end $$;
create or replace function public.sw_release(uid uuid, addr text, sol numeric) returns void
language sql security definer set search_path = '' as $$
  update private.server_wallet_spend set spent_sol = greatest(0, spent_sol - sol)
  where address = addr and user_id = uid and day = (now() at time zone 'utc')::date
$$;

create or replace function public.sw_limits(uid uuid, addr text, cap numeric, alert numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.server_wallets set daily_cap_sol = cap, alert_balance_sol = alert where user_id = uid and address = addr;
  insert into public.audit_log (user_id, event, detail) values (uid, 'server_wallet_limits', jsonb_build_object('address', addr, 'daily_cap_sol', cap, 'alert_balance_sol', alert));
end $$;

-- suppression d'un wallet ; les numéros des autres ne changent pas
create or replace function public.sw_delete(uid uuid, addr text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.server_wallets where user_id = uid and address = addr;
  insert into public.audit_log (user_id, event, detail) values (uid, 'server_wallet_deleted', jsonb_build_object('address', addr));
  if not exists (select 1 from public.server_wallets where user_id = uid) then delete from private.server_wallet_pw where user_id = uid; end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['sw_list(uuid)', 'sw_get(uuid,text)', 'sw_pw_get(uuid)', 'sw_pw_set(uuid,text,text,integer)', 'sw_pw_result(uuid,boolean)',
    'sw_create(uuid,text,text,text)', 'sw_reserve(uuid,text,numeric)', 'sw_release(uuid,text,numeric)', 'sw_limits(uuid,text,numeric,numeric)', 'sw_delete(uuid,text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;

-- surveillance des ordres : un seul rang par ordre (le wallet rapide n°1 sert d'indicateur ; la vente cherche
-- ensuite le wallet rapide qui détient le token)
create or replace function public.watch_orders_due2()
 returns table(order_id uuid, user_id uuid, mint text, symbol text, kind text, value numeric, pct numeric, ref_price numeric, state jsonb, peak numeric, armed boolean, notify boolean, server_address text, auto_exec boolean, client_id text)
 language sql stable security definer set search_path to ''
as $function$
  select o.id, o.user_id, o.mint, o.symbol, o.kind, o.value, o.pct, o.ref_price, o.state, w.peak, coalesce(w.armed, false),
         p.notify_orders and exists (select 1 from public.push_subscriptions s where s.user_id = o.user_id),
         sw.address,
         coalesce((p.extra -> 'studio' ->> 'autoExec')::boolean, true),
         o.client_id
  from public.orders o
  join public.preferences p on p.user_id = o.user_id
  left join private.order_watch w on w.order_id = o.id
  left join lateral (select x.address from public.server_wallets x where x.user_id = o.user_id order by x.num limit 1) sw on true
  where o.active and w.alerted_at is null and o.claimed_by is null
    and ((p.notify_orders and exists (select 1 from public.push_subscriptions s where s.user_id = o.user_id)) or sw.address is not null)
  order by o.created_at
  limit 2000
$function$;
