-- Surveillance des ordres chaque minute : la fonction order-watch compare les prix et envoie les alertes push.
-- La clé est lue dans Vault à chaque appel : elle n'est jamais écrite dans la tâche.
select cron.schedule(
  'order-watch',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://juuytckoiheivddkkrgk.supabase.co/functions/v1/order-watch',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-watch-key', public.app_secret('watch_key')),
       body := '{}'::jsonb,
       timeout_milliseconds := 50000
     ) $$
);
-- les réponses des appels réseau ne sont gardées qu'une journée
select cron.schedule('net-response-cleanup', '17 3 * * *', $$ delete from net._http_response where created < now() - interval '1 day' $$);
