-- Ne plus suivre un créateur efface aussi ses lancements de la liste du compte.
create or replace function private.creators_clear_launches() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.creator_launches where user_id = old.user_id and creator = old.address;
  return old;
end $$;
create trigger creators_clear_launches after delete on public.creators
  for each row execute function private.creators_clear_launches();

-- lancements déjà orphelins (créateurs retirés avant ce changement)
delete from public.creator_launches l
where not exists (select 1 from public.creators c where c.user_id = l.user_id and c.address = l.creator);
