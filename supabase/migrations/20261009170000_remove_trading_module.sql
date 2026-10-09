-- Retrait complet du module de trading automatique : tables, temps réel, réglages enregistrés, règle de limites.
alter publication supabase_realtime drop table public.bot_trades;
drop table if exists public.bot_trades;
drop table if exists public.bot_strategies;

-- réglages de l'ancien module dans les préférences du compte
update public.preferences set extra = extra - 'bot' where extra ? 'bot';

-- limites par compte, sans l'ancienne table
create or replace function private.enforce_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int; lim int;
begin
  lim := case tg_table_name when 'drafts' then 50 when 'tokens' then 2000 when 'orders' then 500 when 'wallets' then 10
    when 'operations' then 20000 else 100000 end;
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into n using new.user_id;
  if n >= lim then raise exception 'Limite atteinte pour %: % éléments maximum', tg_table_name, lim using errcode = 'P0001'; end if;
  return new;
end; $$;
