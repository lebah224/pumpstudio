-- Synchronisation : chaque élément créé dans le navigateur garde son identifiant local (client_id),
-- ce qui permet des imports répétés sans doublon (upsert sur user_id + client_id).
alter table public.operations add column client_id text check (char_length(client_id) between 1 and 64);
alter table public.orders add column client_id text check (char_length(client_id) between 1 and 64);
alter table public.bot_trades add column client_id text check (char_length(client_id) between 1 and 64);
alter table public.drafts add column client_id text check (char_length(client_id) between 1 and 64);
alter table public.operations add constraint operations_user_client unique (user_id, client_id);
alter table public.orders add constraint orders_user_client unique (user_id, client_id);
alter table public.bot_trades add constraint bot_trades_user_client unique (user_id, client_id);
alter table public.drafts add constraint drafts_user_client unique (user_id, client_id);
-- le journal local peut contenir des opérations sans token (frais de créateur) ou au mint vide
alter table public.operations drop constraint if exists operations_mint_check;
alter table public.operations add constraint operations_mint_check check (mint is null or mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$');
-- limite anti-abus sur le journal et les trades du bot
create or replace function private.enforce_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int; lim int;
begin
  lim := case tg_table_name when 'drafts' then 50 when 'tokens' then 2000 when 'orders' then 500 when 'wallets' then 10
    when 'operations' then 20000 when 'bot_trades' then 20000 else 100000 end;
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into n using new.user_id;
  if n >= lim then raise exception 'Limite atteinte pour %: % éléments maximum', tg_table_name, lim using errcode = 'P0001'; end if;
  return new;
end; $$;
create trigger operations_limit before insert on public.operations for each row execute function private.enforce_limits();
create trigger bot_trades_limit before insert on public.bot_trades for each row execute function private.enforce_limits();
revoke all on all functions in schema private from public, anon, authenticated;
