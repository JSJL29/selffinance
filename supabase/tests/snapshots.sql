-- Photo quotidienne du patrimoine (wealth_snapshots). À exécuter tel quel : tout est annulé. Renvoie 'OK'.
begin;
delete from public.fx_rates where currency = 'ZZZ';
insert into public.accounts (uid, bank, currency, balance) values
  ('test-snap-a', 'Test', 'EUR', 100),
  ('test-snap-z', 'Test', 'ZZZ', 50);
insert into public.manual_accounts (id, name, kind, envelope, currency, cash_balance)
values ('00000000-0000-0000-0000-0000000003a1', 'Livret test', 'savings', 'livret_a', 'EUR', 200);

do $$
declare r record;
begin
  perform public.take_wealth_snapshot('2026-01-10');
  perform public.take_wealth_snapshot('2026-01-10'); -- relancée : pas de doublon

  if (select count(*) from public.wealth_snapshots where date = '2026-01-10'
      and (bank_uid in ('test-snap-a', 'test-snap-z') or manual_id = '00000000-0000-0000-0000-0000000003a1')) <> 3 then
    raise exception 'photo non idempotente';
  end if;

  select value_eur, invested_eur into r from public.wealth_snapshots where date = '2026-01-10' and bank_uid = 'test-snap-a';
  if r.value_eur is distinct from 100 then raise exception 'compte EUR : %', r.value_eur; end if;
  if (select value_eur from public.wealth_snapshots where date = '2026-01-10' and bank_uid = 'test-snap-z') is not null then
    raise exception 'taux absent replié sur une valeur';
  end if;
  select value_eur, invested_eur into r from public.wealth_snapshots
  where date = '2026-01-10' and manual_id = '00000000-0000-0000-0000-0000000003a1';
  if r.value_eur is distinct from 200 or r.invested_eur is not null then raise exception 'livret : %', row_to_json(r); end if;

  -- Reconnexion bancaire : l'uid change, l'historique suit
  update public.accounts set uid = 'test-snap-a2' where uid = 'test-snap-a';
  if not exists (select 1 from public.wealth_snapshots where date = '2026-01-10' and bank_uid = 'test-snap-a2') then
    raise exception 'historique perdu après changement d''uid';
  end if;

  if has_function_privilege('authenticated', 'public.take_wealth_snapshot(date)', 'execute') then
    raise exception 'take_wealth_snapshot exécutable par authenticated';
  end if;
  if has_function_privilege('authenticated', 'public.run_wealth_snapshot(boolean)', 'execute') then
    raise exception 'run_wealth_snapshot exécutable par authenticated';
  end if;
end $$;

select 'OK' as resultat;
rollback;
