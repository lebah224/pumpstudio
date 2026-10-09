-- Test d'isolation des comptes (à lancer dans l'éditeur SQL de Supabase ; tout est annulé à la fin).
-- Remplace l'identifiant ci-dessous par celui d'un compte de test. Chaque ligne « other_rows » doit valoir 0,
-- et chaque accès privé doit être « refusé ».
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0b0b0b0b-0000-4000-8000-0000000a1e47","role":"authenticated"}', true);
create temp table if not exists rls_out (t text, other_rows int) on commit drop;
do $$
declare t text; n int; me text := current_setting('request.jwt.claims')::json->>'sub';
begin
  foreach t in array array['profiles','preferences','wallets','drafts','tokens','operations','orders','distributions','audit_log','push_subscriptions','server_wallets'] loop
    execute format('select count(*) from public.%I where %s <> %L', t, case when t='profiles' then 'id' else 'user_id' end, me) into n;
    insert into rls_out values (t, n);
  end loop;
  begin perform 1 from private.step_up limit 1; insert into rls_out values ('private.step_up LISIBLE', 1); exception when insufficient_privilege then insert into rls_out values ('private.step_up refusé', 0); end;
  begin perform 1 from private.server_wallet_keys limit 1; insert into rls_out values ('private.server_wallet_keys LISIBLE', 1); exception when insufficient_privilege then insert into rls_out values ('private.server_wallet_keys refusé', 0); end;
  begin perform public.sec_rate('x', 1, 1); insert into rls_out values ('sec_rate APPELABLE', 1); exception when insufficient_privilege then insert into rls_out values ('sec_rate refusé', 0); end;
  begin perform public.sec_sessions(gen_random_uuid()); insert into rls_out values ('sec_sessions APPELABLE', 1); exception when insufficient_privilege then insert into rls_out values ('sec_sessions refusé', 0); end;
  begin update public.profiles set bio = 'test' where id <> me::uuid; get diagnostics n = row_count; insert into rls_out values ('modification du profil d''un autre compte', n); end;
end $$;
select * from rls_out;
rollback;
