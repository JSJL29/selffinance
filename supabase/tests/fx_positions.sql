-- Taux absent => null (pas de repli à 1) ; replace_positions atomique. À exécuter tel quel : tout est annulé. Renvoie 'OK'.
begin;
delete from public.fx_rates where currency = 'ZZZ';
insert into public.accounts (uid, bank, currency, balance) values ('test-fx-zzz', 'Test', 'ZZZ', 100);
insert into public.transactions (account_uid, booking_date, amount, currency, raw)
values ('test-fx-zzz', current_date, -10, 'ZZZ', '{}');

insert into public.manual_accounts (id, name, kind, envelope)
values ('00000000-0000-0000-0000-0000000002a1', 'CTO test', 'investment', 'cto');
insert into public.instruments (id, name, type, currency, price_source, source_symbol)
values ('00000000-0000-0000-0000-0000000002b1', 'Titre A', 'stock', 'EUR', 'manual', 'test:a'),
       ('00000000-0000-0000-0000-0000000002b2', 'Titre B', 'stock', 'EUR', 'manual', 'test:b');
insert into public.positions (account_id, instrument_id, quantity, avg_cost)
values ('00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-0000000002b1', 5, 10);

do $$
declare n int;
begin
  if (select balance_eur from public.account_view where uid = 'test-fx-zzz') is not null then
    raise exception 'account_view : taux absent replié sur une valeur';
  end if;
  if (select amount_eur from public.transaction_view where account_uid = 'test-fx-zzz') is not null then
    raise exception 'transaction_view : taux absent replié sur une valeur';
  end if;

  -- Remplacement : l'ancienne position disparaît, la nouvelle est écrite
  n := public.replace_positions('00000000-0000-0000-0000-0000000002a1',
    '[{"instrument_id":"00000000-0000-0000-0000-0000000002b2","quantity":3,"avg_cost":7.5,"cost_currency":"EUR"}]');
  if n <> 1 or (select count(*) from public.positions where account_id = '00000000-0000-0000-0000-0000000002a1') <> 1
     or not exists (select 1 from public.positions where instrument_id = '00000000-0000-0000-0000-0000000002b2' and quantity = 3) then
    raise exception 'replace_positions : remplacement incorrect';
  end if;

  -- Échec (instrument inconnu) : rien n'est supprimé
  begin
    perform public.replace_positions('00000000-0000-0000-0000-0000000002a1',
      '[{"instrument_id":"00000000-0000-0000-0000-0000000009ff","quantity":1,"avg_cost":1,"cost_currency":"EUR"}]');
    raise exception 'instrument inconnu accepté';
  exception when foreign_key_violation then null;
  end;
  if (select count(*) from public.positions where account_id = '00000000-0000-0000-0000-0000000002a1') <> 1 then
    raise exception 'replace_positions : positions perdues après un échec';
  end if;

  if has_function_privilege('authenticated', 'public.replace_positions(uuid, jsonb)', 'execute') then
    raise exception 'replace_positions exécutable par authenticated';
  end if;
end $$;

select 'OK' as resultat;
rollback;
