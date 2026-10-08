-- Droits précis sur les préférences : toutes les colonnes sauf l'identifiant
revoke update on public.preferences from authenticated;
grant update (ui_theme, ui_depth, sim_mode, slippage_pct, max_buy_sol, priority, dev_max_pct, studio_universe, studio_tone, studio_lang, notify_email, notify_orders, extra) on public.preferences to authenticated;

-- ---------- updated_at automatique ----------
create or replace function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;

create trigger profiles_updated before update on public.profiles for each row execute function private.set_updated_at();
create trigger preferences_updated before update on public.preferences for each row execute function private.set_updated_at();
create trigger drafts_updated before update on public.drafts for each row execute function private.set_updated_at();
create trigger orders_updated before update on public.orders for each row execute function private.set_updated_at();
create trigger bot_strategies_updated before update on public.bot_strategies for each row execute function private.set_updated_at();
create trigger distributions_updated before update on public.distributions for each row execute function private.set_updated_at();

-- ---------- inscription : profil + préférences ----------
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.preferences (user_id) values (new.id) on conflict do nothing;
  insert into public.audit_log (user_id, event, detail) values (new.id, 'account_created', jsonb_build_object('email', new.email is not null));
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

-- ---------- connexion par wallet : l'adresse signée devient un wallet vérifié du compte ----------
create or replace function private.handle_web3_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare addr text;
begin
  if new.provider <> 'web3' then return new; end if;
  addr := coalesce(new.identity_data->>'address', split_part(new.provider_id, ':', 3));
  if addr is null or addr !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return new; end if;
  insert into public.wallets (user_id, address, label, is_primary)
  values (new.user_id, addr, 'Wallet de connexion', not exists (select 1 from public.wallets w where w.user_id = new.user_id and w.is_primary))
  on conflict (address) do nothing;
  return new;
end; $$;
create trigger on_auth_identity_created after insert on auth.identities for each row execute function private.handle_web3_identity();

-- ---------- audit des actions sensibles ----------
create or replace function private.audit_wallets() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (user_id, event, detail) values (new.user_id, 'wallet_added', jsonb_build_object('address', new.address));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (user_id, event, detail) values (old.user_id, 'wallet_removed', jsonb_build_object('address', old.address));
    return old;
  end if;
  return null;
end; $$;
create trigger wallets_audit after insert or delete on public.wallets for each row execute function private.audit_wallets();

create or replace function private.audit_preferences() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.sim_mode is distinct from old.sim_mode then
    insert into public.audit_log (user_id, event, detail) values (new.user_id, case when new.sim_mode then 'mode_simulation' else 'mode_reel' end, '{}'::jsonb);
  end if;
  if new.max_buy_sol is distinct from old.max_buy_sol then
    insert into public.audit_log (user_id, event, detail) values (new.user_id, 'limite_achat_modifiee', jsonb_build_object('avant', old.max_buy_sol, 'apres', new.max_buy_sol));
  end if;
  return new;
end; $$;
create trigger preferences_audit after update on public.preferences for each row execute function private.audit_preferences();

-- ---------- limites anti-abus par compte ----------
create or replace function private.enforce_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int; lim int;
begin
  lim := case tg_table_name when 'drafts' then 50 when 'tokens' then 2000 when 'orders' then 500 when 'wallets' then 10 else 100000 end;
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into n using new.user_id;
  if n >= lim then raise exception 'Limite atteinte pour %: % éléments maximum', tg_table_name, lim using errcode = 'P0001'; end if;
  return new;
end; $$;
create trigger drafts_limit before insert on public.drafts for each row execute function private.enforce_limits();
create trigger tokens_limit before insert on public.tokens for each row execute function private.enforce_limits();
create trigger orders_limit before insert on public.orders for each row execute function private.enforce_limits();
create trigger wallets_limit before insert on public.wallets for each row execute function private.enforce_limits();

revoke all on all functions in schema private from public, anon, authenticated;
