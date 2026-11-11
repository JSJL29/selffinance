-- Test du schéma Patrimoine. À exécuter tel quel (MCP execute_sql) : tout est annulé.
-- Lève une exception au premier écart ; renvoie 'OK' sinon.
begin;

insert into public.manual_accounts (id, name, kind, envelope, cash_balance)
values ('00000000-0000-0000-0000-0000000000a1', 'PEA test', 'investment', 'pea', 100);

insert into public.instruments (id, name, type, currency, price_source, source_symbol, last_price) values
  ('00000000-0000-0000-0000-0000000000b1', 'T ETF',        'etf',   'EUR', 'yahoo',  'X.PA', 110),
  ('00000000-0000-0000-0000-0000000000b2', 'T Sans cours', 'stock', 'EUR', 'manual', null,   null),
  ('00000000-0000-0000-0000-0000000000b3', 'T Sans taux',  'stock', 'XXX', 'manual', 'Y',    50);

insert into public.positions (account_id, instrument_id, quantity, avg_cost) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 10, 100),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', 5, 20),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b3', 1, 40);

do $$
declare r record;
begin
  -- Position valorisée
  select * into r from public.position_view where instrument_id = '00000000-0000-0000-0000-0000000000b1';
  if r.value_eur <> 1100 or r.invested_eur <> 1000 or r.pnl_eur <> 100 or round(r.pnl_pct, 4) <> 0.1 then
    raise exception 'position b1 : %', row_to_json(r);
  end if;
  -- Sans cours : valeur et plus-value nulles
  select * into r from public.position_view where instrument_id = '00000000-0000-0000-0000-0000000000b2';
  if r.value_eur is not null or r.pnl_eur is not null then raise exception 'position b2 : %', row_to_json(r); end if;
  -- Devise sans taux : valeur nulle (pas de repli à 1)
  select * into r from public.position_view where instrument_id = '00000000-0000-0000-0000-0000000000b3';
  if r.value_eur is not null then raise exception 'position b3 : %', row_to_json(r); end if;

  -- Compte : liquidités dans la valeur, hors investi ; seules les lignes valorisées comptent
  select * into r from public.manual_account_view where id = '00000000-0000-0000-0000-0000000000a1';
  if r.cash_eur <> 100 or r.positions_value_eur <> 1100 or r.value_eur <> 1200
     or r.invested_eur <> 1000 or r.pnl_eur <> 100 or r.missing_prices <> 2 then
    raise exception 'compte : %', row_to_json(r);
  end if;

  -- Suppression du compte : positions supprimées, titres conservés
  delete from public.manual_accounts where id = '00000000-0000-0000-0000-0000000000a1';
  if exists (select 1 from public.positions where account_id = '00000000-0000-0000-0000-0000000000a1') then
    raise exception 'positions non supprimées';
  end if;
  if (select count(*) from public.instruments where id::text like '00000000-0000-0000-0000-0000000000b%') <> 3 then
    raise exception 'titres supprimés';
  end if;

  -- Unicité (isin, source_symbol) avec isin null
  begin
    insert into public.instruments (name, type, currency, price_source, source_symbol) values ('Doublon', 'etf', 'EUR', 'yahoo', 'X.PA');
    raise exception 'doublon (isin null, X.PA) accepté';
  exception when unique_violation then null;
  end;
end $$;

select 'OK' as resultat;
rollback;
