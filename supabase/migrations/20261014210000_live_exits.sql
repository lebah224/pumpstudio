-- Ventes en temps réel : les stratégies de sortie sont aussi évaluées par l'écoute continue (creator-stream), à chaque
-- transaction du token ; la surveillance toutes les 5 secondes (strategy-watch) reste en filet de sécurité.
-- Deux surveillances : la prise d'une règle est atomique et refusée si cette règle a déjà été exécutée.

create or replace function public.strategy_claim_rule(p_id uuid, p_rule text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.strategies set busy_at = now()
  where id = p_id and status = 'active' and (busy_at is null or busy_at < now() - interval '2 minutes')
    and not coalesce(state->'fired', '[]'::jsonb) ? p_rule;
  get diagnostics n = row_count; return n > 0;
end $$;
revoke all on function public.strategy_claim_rule(uuid, text) from public, anon, authenticated;
grant execute on function public.strategy_claim_rule(uuid, text) to service_role;

-- l'écoute continue tourne aussi tant qu'une stratégie de sortie est active
select cron.alter_job(
  (select jobid from cron.job where jobname = 'creator-stream'),
  command := $$ select net.http_post(
       url := 'https://juuytckoiheivddkkrgk.supabase.co/functions/v1/creator-stream',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-watch-key', public.app_secret('watch_key')),
       body := '{}'::jsonb,
       timeout_milliseconds := 10000
     ) where exists (select 1 from public.creators where alerts) or exists (select 1 from public.snipes where enabled)
          or exists (select 1 from public.strategies where status = 'active') $$
);
