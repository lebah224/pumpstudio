-- Surveillance des ordres toutes les 10 secondes (au lieu de chaque minute) : vente serveur sous 10 à 15 s.
-- Environ 260 000 appels par mois, dans les limites gratuites. Le verrou des ordres empêche toute double vente
-- si deux passages se chevauchent.
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'order-watch'), schedule := '10 seconds');
