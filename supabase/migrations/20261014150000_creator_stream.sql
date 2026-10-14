-- Détection en temps réel des lancements des créateurs suivis (fonction creator-stream, flux continu).
-- La surveillance par interrogation (creator-watch) devient un filet de sécurité, créateur par créateur, toutes les 30 s.

alter table public.creator_launches
  add column sig text check (char_length(sig) <= 100),
  add column source text check (source in ('stream', 'poll')),
  add column detect_ms integer;

create or replace function public.creator_launch_record2(p_creator text, p_mint text, p_symbol text, p_name text, p_image text, p_at timestamptz, p_sig text, p_source text)
returns table (r_user uuid, r_label text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with ins as (
    insert into public.creator_launches (user_id, creator, mint, symbol, name, image, launched_at, sig, source)
    select c.user_id, p_creator, p_mint, left(p_symbol, 32), left(p_name, 80), left(p_image, 300), p_at, left(p_sig, 100), p_source
    from public.creators c where c.address = p_creator and c.alerts
    on conflict (user_id, mint) do nothing
    returning creator_launches.user_id
  ), upd as (
    update public.creators c set last_mint = p_mint, last_launch_at = p_at
    where c.address = p_creator and c.user_id in (select ins.user_id from ins)
    returning c.user_id, c.label
  )
  select upd.user_id, upd.label from upd;
end $$;

-- heure du bloc de création connue : délai de détection mesuré, et l'heure de lancement devient celle du bloc
create or replace function public.creator_launch_timing(p_mint text, p_block_at timestamptz)
returns void
language sql security definer set search_path = '' as $$
  update public.creator_launches
  set detect_ms = greatest(0, round(extract(epoch from (launched_at - p_block_at)) * 1000))::int, launched_at = p_block_at
  where mint = p_mint and source = 'stream' and detect_ms is null
$$;

do $$ declare f text; begin
  foreach f in array array['creator_launch_record2(text,text,text,text,text,timestamptz,text,text)', 'creator_launch_timing(text,timestamptz)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;

-- écoute continue : un passage par minute, chacun écoute ~75 s (chevauchement, pas de trou)
select cron.schedule(
  'creator-stream',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://juuytckoiheivddkkrgk.supabase.co/functions/v1/creator-stream',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-watch-key', public.app_secret('watch_key')),
       body := '{}'::jsonb,
       timeout_milliseconds := 10000
     ) where exists (select 1 from public.creators where alerts) $$
);
-- filet de sécurité : interrogation par créateur suivi, toutes les 30 s
select cron.schedule(
  'creator-watch',
  '30 seconds',
  $$ select net.http_post(
       url := 'https://juuytckoiheivddkkrgk.supabase.co/functions/v1/creator-watch',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-watch-key', public.app_secret('watch_key')),
       body := '{}'::jsonb,
       timeout_milliseconds := 25000
     ) where exists (select 1 from public.creators where alerts) $$
);
