-- Wallet rapide serveur : wallet de trading dont la clé est gardée chiffrée par le serveur.
-- La clé (AES-256-GCM, clé maître dans Vault) n'est déchiffrée que dans la fonction server-wallet.
-- Garde-fous : plafond par trade et par jour (comptés sur simulation), retraits seulement vers les wallets
-- liés du compte, mot de passe du wallet pour l'export, les retraits, les plafonds et la suppression.

create table public.server_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  address text not null unique check (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  daily_cap_sol numeric(12,4) not null default 10 check (daily_cap_sol > 0 and daily_cap_sol <= 100),
  alert_balance_sol numeric(12,4) not null default 5 check (alert_balance_sol >= 0 and alert_balance_sol <= 100000),
  created_at timestamptz not null default now(),
  last_tx_at timestamptz
);
alter table public.server_wallets enable row level security;
create policy "wallet serveur : lecture du mien" on public.server_wallets for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.server_wallets from anon, authenticated;
grant select on public.server_wallets to authenticated;

create table private.server_wallet_keys (
  user_id uuid primary key references public.server_wallets(user_id) on delete cascade,
  enc text not null, iv text not null,
  pw_hash text not null, pw_salt text not null, pw_iter integer not null,
  fails integer not null default 0,
  locked_until timestamptz
);
create table private.server_wallet_spend (
  user_id uuid not null references public.server_wallets(user_id) on delete cascade,
  day date not null,
  spent_sol numeric(20,9) not null default 0,
  primary key (user_id, day)
);
revoke all on private.server_wallet_keys, private.server_wallet_spend from public, anon, authenticated;

-- lecture complète pour la fonction serveur (rôle service uniquement)
create or replace function public.srvw_get(uid uuid) returns table (
  address text, daily_cap_sol numeric, alert_balance_sol numeric, enc text, iv text,
  pw_hash text, pw_salt text, pw_iter integer, fails integer, locked_until timestamptz, spent_today numeric
) language sql stable security definer set search_path = '' as $$
  select w.address, w.daily_cap_sol, w.alert_balance_sol, k.enc, k.iv, k.pw_hash, k.pw_salt, k.pw_iter, k.fails, k.locked_until,
         coalesce((select s.spent_sol from private.server_wallet_spend s where s.user_id = w.user_id and s.day = (now() at time zone 'utc')::date), 0)
  from public.server_wallets w join private.server_wallet_keys k on k.user_id = w.user_id
  where w.user_id = uid
$$;

create or replace function public.srvw_create(uid uuid, addr text, p_enc text, p_iv text, p_hash text, p_salt text, p_iter integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.server_wallets (user_id, address) values (uid, addr);
  insert into private.server_wallet_keys (user_id, enc, iv, pw_hash, pw_salt, pw_iter) values (uid, p_enc, p_iv, p_hash, p_salt, p_iter);
  insert into public.audit_log (user_id, event, detail) values (uid, 'server_wallet_created', jsonb_build_object('address', addr));
end $$;

-- résultat d'une vérification de mot de passe : 5 échecs = blocage 15 minutes
create or replace function public.srvw_pw_result(uid uuid, ok boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if ok then update private.server_wallet_keys set fails = 0, locked_until = null where user_id = uid;
  else
    update private.server_wallet_keys set fails = fails + 1,
      locked_until = case when fails + 1 >= 5 then now() + interval '15 minutes' else locked_until end
    where user_id = uid;
    insert into public.audit_log (user_id, event, detail) values (uid, 'server_wallet_bad_password', '{}'::jsonb);
  end if;
end $$;

-- réserve un montant dans le plafond du jour, de façon atomique ; refuse au-delà
create or replace function public.srvw_reserve(uid uuid, sol numeric) returns numeric
language plpgsql security definer set search_path = '' as $$
declare cap numeric; cur numeric; d date := (now() at time zone 'utc')::date;
begin
  select daily_cap_sol into cap from public.server_wallets where user_id = uid for update;
  if cap is null then raise exception 'Wallet serveur introuvable'; end if;
  insert into private.server_wallet_spend (user_id, day) values (uid, d) on conflict do nothing;
  select spent_sol into cur from private.server_wallet_spend where user_id = uid and day = d for update;
  if cur + sol > cap then raise exception 'Plafond journalier atteint (% SOL sur % SOL)', round(cur, 3), cap; end if;
  update private.server_wallet_spend set spent_sol = spent_sol + sol where user_id = uid and day = d;
  update public.server_wallets set last_tx_at = now() where user_id = uid;
  return cap - cur - sol;
end $$;
create or replace function public.srvw_release(uid uuid, sol numeric) returns void
language sql security definer set search_path = '' as $$
  update private.server_wallet_spend set spent_sol = greatest(0, spent_sol - sol) where user_id = uid and day = (now() at time zone 'utc')::date
$$;

create or replace function public.srvw_limits(uid uuid, cap numeric, alert numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.server_wallets set daily_cap_sol = cap, alert_balance_sol = alert where user_id = uid;
  insert into public.audit_log (user_id, event, detail) values (uid, 'server_wallet_limits', jsonb_build_object('daily_cap_sol', cap, 'alert_balance_sol', alert));
end $$;

create or replace function public.srvw_delete(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare addr text;
begin
  delete from public.server_wallets where user_id = uid returning address into addr;
  insert into public.audit_log (user_id, event, detail) values (uid, 'server_wallet_deleted', jsonb_build_object('address', addr));
end $$;

do $$ declare f text; begin
  foreach f in array array['srvw_get(uuid)', 'srvw_create(uuid,text,text,text,text,text,integer)', 'srvw_pw_result(uuid,boolean)',
    'srvw_reserve(uuid,numeric)', 'srvw_release(uuid,numeric)', 'srvw_limits(uuid,numeric,numeric)', 'srvw_delete(uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;
