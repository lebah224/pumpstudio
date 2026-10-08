-- Suppression du compte : quand le compte lui-même est supprimé, ses wallets partent en cascade ;
-- l'audit « wallet retiré » n'a alors plus de compte auquel se rattacher, on ne l'écrit pas.
create or replace function private.audit_wallets() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (user_id, event, detail) values (new.user_id, 'wallet_added', jsonb_build_object('address', new.address));
    return new;
  elsif tg_op = 'DELETE' then
    if exists (select 1 from auth.users where id = old.user_id) then
      insert into public.audit_log (user_id, event, detail) values (old.user_id, 'wallet_removed', jsonb_build_object('address', old.address));
    end if;
    return old;
  end if;
  return null;
end; $$;
