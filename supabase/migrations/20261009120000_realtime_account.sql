-- Direct entre appareils : les changements des données du compte sont diffusés (Supabase Realtime).
-- Chaque appareil ne reçoit que les lignes de son compte (filtre user_id + politiques RLS de lecture).
do $$
declare t text;
begin
  foreach t in array array['tokens', 'operations', 'orders', 'distributions', 'bot_trades'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
