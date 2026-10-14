-- Créateurs suivis : adresses de wallets créateurs pump.fun, avec un nom et une note, et alerte à chaque lancement.
-- La surveillance (fonction creator-watch, toutes les 5 secondes) lit les derniers tokens créés sur pump.fun et
-- enregistre les lancements des créateurs suivis ; une notification part vers les appareils du compte.

create table public.creators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null check (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  label text check (char_length(label) <= 32),
  note text check (char_length(note) <= 280),
  alerts boolean not null default true,
  last_mint text,
  last_launch_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, address)
);
create index creators_alerts_idx on public.creators (address) where alerts;
alter table public.creators enable row level security;
create policy "créateurs : lecture" on public.creators for select to authenticated using (user_id = (select auth.uid()));
create policy "créateurs : ajout" on public.creators for insert to authenticated
  with check (user_id = (select auth.uid()) and (select count(*) from public.creators c where c.user_id = (select auth.uid())) < 100);
create policy "créateurs : modification" on public.creators for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "créateurs : retrait" on public.creators for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.creators from anon;
grant select, insert, delete on public.creators to authenticated;
grant update (label, note, alerts, updated_at) on public.creators to authenticated;
create or replace function private.creators_touch() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;
create trigger creators_touch before update on public.creators for each row execute function private.creators_touch();

-- lancements détectés (un par token et par compte)
create table public.creator_launches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator text not null,
  mint text not null check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  symbol text check (char_length(symbol) <= 32),
  name text check (char_length(name) <= 80),
  image text check (char_length(image) <= 300),
  launched_at timestamptz not null,
  seen_at timestamptz not null default now(),
  unique (user_id, mint)
);
create index creator_launches_user_idx on public.creator_launches (user_id, seen_at desc);
alter table public.creator_launches enable row level security;
create policy "lancements : lecture" on public.creator_launches for select to authenticated using (user_id = (select auth.uid()));
create policy "lancements : effacement" on public.creator_launches for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.creator_launches from anon;
grant select, delete on public.creator_launches to authenticated;
alter publication supabase_realtime add table public.creator_launches;

-- serveur : créateurs à surveiller, enregistrement des lancements (nouveaux seulement)
create or replace function public.creators_watched() returns table (address text)
language sql stable security definer set search_path = '' as $$
  select distinct address from public.creators where alerts
$$;
create or replace function public.creator_launch_record(p_creator text, p_mint text, p_symbol text, p_name text, p_image text, p_at timestamptz)
returns table (r_user uuid, r_label text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with ins as (
    insert into public.creator_launches (user_id, creator, mint, symbol, name, image, launched_at)
    select c.user_id, p_creator, p_mint, left(p_symbol, 32), left(p_name, 80), left(p_image, 300), p_at
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
-- chaque compte garde ses 200 derniers lancements
create or replace function public.creator_launches_trim() returns void
language sql security definer set search_path = '' as $$
  delete from public.creator_launches l using (
    select id from (select id, row_number() over (partition by user_id order by seen_at desc) rn from public.creator_launches) x where rn > 200
  ) old where l.id = old.id
$$;
do $$ declare f text; begin
  foreach f in array array['creators_watched()', 'creator_launch_record(text,text,text,text,text,timestamptz)', 'creator_launches_trim()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;

select cron.schedule(
  'creator-watch',
  '5 seconds',
  $$ select net.http_post(
       url := 'https://juuytckoiheivddkkrgk.supabase.co/functions/v1/creator-watch',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-watch-key', public.app_secret('watch_key')),
       body := '{}'::jsonb,
       timeout_milliseconds := 20000
     ) where exists (select 1 from public.creators where alerts) $$
);
select cron.schedule('creator-launches-trim', '23 4 * * *', $$ select public.creator_launches_trim() $$);
