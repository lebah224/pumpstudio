-- Clés API du compte (Helius, Pinata) : chiffrées par la fonction account-keys (AES-256-GCM, clé maître du Vault),
-- jamais lisibles en clair dans la base ; accès uniquement par le rôle service.
create table if not exists private.account_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enc text not null,
  iv text not null,
  updated_at timestamptz not null default now()
);
revoke all on private.account_keys from public, anon, authenticated;

create or replace function public.akeys_get(uid uuid) returns table (enc text, iv text)
language sql security definer set search_path = '' as $$
  select k.enc, k.iv from private.account_keys k where k.user_id = uid;
$$;
create or replace function public.akeys_set(uid uuid, p_enc text, p_iv text) returns void
language sql security definer set search_path = '' as $$
  insert into private.account_keys (user_id, enc, iv, updated_at) values (uid, p_enc, p_iv, now())
  on conflict (user_id) do update set enc = excluded.enc, iv = excluded.iv, updated_at = now();
$$;
revoke all on function public.akeys_get(uuid) from public, anon, authenticated;
revoke all on function public.akeys_set(uuid, text, text) from public, anon, authenticated;
grant execute on function public.akeys_get(uuid) to service_role;
grant execute on function public.akeys_set(uuid, text, text) to service_role;
