-- Phase 5 : confirmation renforcée des actions sensibles, appareils connus, sessions, limites d'appels.
-- Tables privées (jamais exposées) ; fonctions réservées au service (fonctions Edge).

-- code de confirmation envoyé par e-mail (un seul en cours par compte), haché
create table if not exists private.step_up (
  user_id uuid primary key references auth.users(id) on delete cascade,
  purpose text not null check (purpose ~ '^[a-z_]{3,32}$'),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  sent_at timestamptz not null default now()
);
-- autorisation obtenue après confirmation : valable 5 minutes, utilisable une fois
create table if not exists private.step_up_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null,
  expires_at timestamptz not null,
  primary key (user_id, purpose)
);
-- appareils déjà vus (identifiant aléatoire du navigateur, haché) : alerte à la première connexion d'un nouvel appareil
create table if not exists private.known_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_hash text not null,
  label text not null default '' check (char_length(label) <= 80),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, device_hash)
);
-- (première version du compteur de limites, remplacée par rate_counters ci-dessous ; inutilisée)
create table if not exists private.rate_hits (
  key text not null,
  at timestamptz not null default now()
);
create index if not exists rate_hits_key_at on private.rate_hits (key, at);
revoke all on private.step_up, private.step_up_grants, private.known_devices, private.rate_hits from public, anon, authenticated;

-- compteur des limites d'appels : une fenêtre fixe par clé, sans suppression de lignes
create table if not exists private.rate_counters (
  key text primary key,
  window_start timestamptz not null default now(),
  n int not null default 0
);
revoke all on private.rate_counters from public, anon, authenticated;

-- limite d'appels : vrai si l'appel est permis (et compté)
create or replace function public.sec_rate(p_key text, p_max int, p_window int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare cur int;
begin
  insert into private.rate_counters as r (key, window_start, n) values (p_key, now(), 1)
  on conflict (key) do update set
    n = case when r.window_start < now() - make_interval(secs => p_window) then 1 else r.n + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window) then now() else r.window_start end
  returning n into cur;
  return cur <= p_max;
end $$;

create or replace function public.sec_stepup_set(uid uuid, p_purpose text, p_hash text, p_ttl int) returns void
language sql security definer set search_path = '' as $$
  insert into private.step_up (user_id, purpose, code_hash, expires_at, attempts, sent_at)
  values (uid, p_purpose, p_hash, now() + make_interval(secs => p_ttl), 0, now())
  on conflict (user_id) do update set purpose = excluded.purpose, code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = now();
$$;

-- vérifie le code : 'ok' (autorisation créée, code épuisé), 'bad', 'expired', 'locked' (5 essais), 'none'
create or replace function public.sec_stepup_check(uid uuid, p_purpose text, p_hash text) returns text
language plpgsql security definer set search_path = '' as $$
declare r private.step_up;
begin
  select * into r from private.step_up where user_id = uid for update;
  if not found or r.purpose <> p_purpose then return 'none'; end if;
  if r.expires_at < now() then return 'expired'; end if;
  if r.attempts >= 5 then return 'locked'; end if;
  if r.code_hash <> p_hash then update private.step_up set attempts = attempts + 1 where user_id = uid; return 'bad'; end if;
  update private.step_up set expires_at = now() - interval '1 second' where user_id = uid;
  insert into private.step_up_grants (user_id, purpose, expires_at) values (uid, p_purpose, now() + interval '5 minutes')
  on conflict (user_id, purpose) do update set expires_at = excluded.expires_at;
  return 'ok';
end $$;

create or replace function public.sec_grant_add(uid uuid, p_purpose text) returns void
language sql security definer set search_path = '' as $$
  insert into private.step_up_grants (user_id, purpose, expires_at) values (uid, p_purpose, now() + interval '5 minutes')
  on conflict (user_id, purpose) do update set expires_at = excluded.expires_at;
$$;

-- consomme une autorisation encore valable (une seule utilisation : elle est marquée expirée)
create or replace function public.sec_grant_consume(uid uuid, p_purpose text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare ok boolean;
begin
  update private.step_up_grants set expires_at = now() - interval '1 second'
  where user_id = uid and purpose = p_purpose and expires_at > now() returning true into ok;
  return coalesce(ok, false);
end $$;

-- appareil vu : renvoie 'new' (jamais vu, d'autres appareils existent), 'first' (premier appareil du compte) ou 'known'
create or replace function public.sec_device_seen(uid uuid, p_hash text, p_label text) returns text
language plpgsql security definer set search_path = '' as $$
declare existed boolean; others int;
begin
  select true into existed from private.known_devices where user_id = uid and device_hash = p_hash;
  if existed then
    update private.known_devices set last_seen = now(), label = left(p_label, 80) where user_id = uid and device_hash = p_hash;
    return 'known';
  end if;
  select count(*) into others from private.known_devices where user_id = uid;
  insert into private.known_devices (user_id, device_hash, label) values (uid, p_hash, left(p_label, 80));
  return case when others = 0 then 'first' else 'new' end;
end $$;

-- sessions ouvertes du compte (appareils connectés)
create or replace function public.sec_sessions(uid uuid) returns table (id uuid, created_at timestamptz, updated_at timestamptz, refreshed_at timestamp, user_agent text, ip text, aal text)
language sql security definer set search_path = '' as $$
  select s.id, s.created_at, s.updated_at, s.refreshed_at, s.user_agent, host(s.ip), s.aal::text
  from auth.sessions s where s.user_id = uid and (s.not_after is null or s.not_after > now())
  order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc limit 50;
$$;

-- ferme une session du compte : elle est marquée expirée, son jeton ne peut plus être renouvelé
create or replace function public.sec_session_revoke(uid uuid, sid uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare ok boolean;
begin
  update auth.sessions set not_after = now() where id = sid and user_id = uid and (not_after is null or not_after > now()) returning true into ok;
  return coalesce(ok, false);
end $$;

do $$
declare f text;
begin
  foreach f in array array['sec_rate(text,int,int)', 'sec_stepup_set(uuid,text,text,int)', 'sec_stepup_check(uuid,text,text)', 'sec_grant_add(uuid,text)',
    'sec_grant_consume(uuid,text)', 'sec_device_seen(uuid,text,text)', 'sec_sessions(uuid)', 'sec_session_revoke(uuid,uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;
