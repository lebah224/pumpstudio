-- Fin de l'essai sans compte : l'outil fonctionne seulement en réel.
-- Les opérations fictives, le réglage de mode et son historique sont supprimés.
delete from public.operations where sim;
delete from public.audit_log where event in ('mode_simulation', 'mode_reel');

create or replace function private.audit_preferences() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.max_buy_sol is distinct from old.max_buy_sol then
    insert into public.audit_log (user_id, event, detail) values (new.user_id, 'limite_achat_modifiee', jsonb_build_object('avant', old.max_buy_sol, 'apres', new.max_buy_sol));
  end if;
  return new;
end; $$;

alter table public.preferences drop column sim_mode;
alter table public.operations drop column sim;
