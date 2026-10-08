-- Connexion par wallet sans création automatique de compte.
-- 1) Le client demande d'abord si un compte existe pour une adresse (réponse : web3, linked ou none).
-- 2) Un wallet lié à un compte (ajouté depuis Mon compte) peut ouvrir ce compte via la fonction wallet-login,
--    qui consomme chaque nonce une seule fois pour empêcher le rejeu d'une signature.

create or replace function public.wallet_account_status(addr text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when addr is null or addr !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then 'none'
    when exists (
      select 1 from auth.identities i
      where i.provider = 'web3'
        and (i.provider_id = 'web3:solana:' || addr or i.identity_data->>'address' = addr)
    ) then 'web3'
    when exists (select 1 from public.wallets w where w.address = addr) then 'linked'
    else 'none'
  end
$$;
revoke all on function public.wallet_account_status(text) from public;
grant execute on function public.wallet_account_status(text) to anon, authenticated;

create table if not exists private.login_nonces (
  nonce text primary key check (nonce ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now()
);
revoke all on private.login_nonces from public, anon, authenticated;

create or replace function public.consume_login_nonce(n text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c integer;
begin
  delete from private.login_nonces where created_at < now() - interval '1 day';
  insert into private.login_nonces (nonce) values (n) on conflict do nothing;
  get diagnostics c = row_count;
  return c = 1;
end $$;
revoke all on function public.consume_login_nonce(text) from public, anon, authenticated;
grant execute on function public.consume_login_nonce(text) to service_role;
