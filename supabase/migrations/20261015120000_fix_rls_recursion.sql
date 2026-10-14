-- Les plafonds par compte (100 créateurs, 50 stratégies, 50 achats automatiques, 50 achats programmés, 10 appareils)
-- comptaient les lignes de la table dans sa propre règle d'ajout : Postgres refuse (« infinite recursion detected in
-- policy »), donc tout ajout échouait. Le comptage passe par une fonction à droits propriétaire,
-- seule dans un schéma à part (le schéma interne reste fermé aux comptes).

create schema if not exists rls;
revoke all on schema rls from public;

create or replace function rls.own_count(p_table text) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n bigint;
begin
  if uid is null then return 0; end if;
  case p_table
    when 'creators' then select count(*) into n from public.creators where user_id = uid;
    when 'strategies' then select count(*) into n from public.strategies where user_id = uid and status in ('active', 'paused');
    when 'snipes' then select count(*) into n from public.snipes where user_id = uid;
    when 'buy_orders' then select count(*) into n from public.buy_orders where user_id = uid and status in ('active', 'paused');
    when 'push_subscriptions' then select count(*) into n from public.push_subscriptions where user_id = uid;
    else raise exception 'table inconnue';
  end case;
  return n;
end $$;
revoke all on function rls.own_count(text) from public, anon;
grant usage on schema rls to authenticated;
grant execute on function rls.own_count(text) to authenticated;

drop policy "créateurs : ajout" on public.creators;
create policy "créateurs : ajout" on public.creators for insert to authenticated
  with check (user_id = (select auth.uid()) and rls.own_count('creators') < 100);

drop policy "stratégies : création" on public.strategies;
create policy "stratégies : création" on public.strategies for insert to authenticated
  with check (user_id = (select auth.uid()) and status in ('active', 'paused') and rls.own_count('strategies') < 50);

drop policy "achats auto : création" on public.snipes;
create policy "achats auto : création" on public.snipes for insert to authenticated
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.server_wallets w where w.user_id = (select auth.uid()) and w.address = snipes.wallet)
    and rls.own_count('snipes') < 50);

drop policy "achats programmés : création" on public.buy_orders;
create policy "achats programmés : création" on public.buy_orders for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'active'
    and exists (select 1 from public.server_wallets w where w.user_id = (select auth.uid()) and w.address = buy_orders.wallet)
    and rls.own_count('buy_orders') < 50);

drop policy "push : ajout d'un appareil" on public.push_subscriptions;
create policy "push : ajout d'un appareil" on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and rls.own_count('push_subscriptions') < 10);
