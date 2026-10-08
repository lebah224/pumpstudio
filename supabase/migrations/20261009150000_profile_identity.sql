-- Identité du profil : pseudo unique sans tenir compte des majuscules, noms réservés interdits,
-- avatar limité à un avatar généré (« gen:<n> ») ou à une image du dossier du compte dans le stockage.
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

alter table public.profiles drop constraint if exists profiles_username_not_reserved;
alter table public.profiles add constraint profiles_username_not_reserved check (username is null or not (lower(username) = any (array['admin','administrator','admins','support','help','helpdesk','contact','tokenstudio','token_studio','tokenstudio_app',
    'pumpfun','pump_fun','pump','pumpportal','solana','phantom','solflare','backpack','jupiter','dexscreener','moderator','mod','staff','root','system',
    'official','team','security','billing','api','www','null','undefined','anonymous'])));

alter table public.profiles drop constraint if exists profiles_avatar_url_format;
alter table public.profiles add constraint profiles_avatar_url_format check (
  avatar_url is null
  or avatar_url ~ '^gen:[0-9]{1,3}$'
  or (avatar_url like 'logos/' || id::text || '/avatar-%' and avatar_url ~ '^logos/[0-9a-f-]{36}/avatar-[0-9]{10,16}\.webp$')
);

-- (liste des noms réservés recopiée dans la contrainte et la fonction : la contrainte ne peut pas appeler une fonction privée)
-- Le pseudo est-il libre ? (format, nom réservé, déjà pris par un autre compte)
create or replace function public.username_available(u text) returns boolean
language sql stable security definer set search_path = '' as $$
  select u ~ '^[A-Za-z0-9_]{3,24}$'
    and not (lower(u) = any (array['admin','administrator','admins','support','help','helpdesk','contact','tokenstudio','token_studio','tokenstudio_app',
    'pumpfun','pump_fun','pump','pumpportal','solana','phantom','solflare','backpack','jupiter','dexscreener','moderator','mod','staff','root','system',
    'official','team','security','billing','api','www','null','undefined','anonymous']))
    and not exists (select 1 from public.profiles p where lower(p.username) = lower(u) and p.id <> (select auth.uid()));
$$;
revoke all on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;
