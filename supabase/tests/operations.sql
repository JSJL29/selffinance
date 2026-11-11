-- Ventes, dividendes, annulations et bilan fiscal. À exécuter tel quel : tout est annulé. Renvoie 'OK'.
begin;
-- Comptes : A et B (CTO, EUR), P (PEA)
insert into public.manual_accounts (id, name, kind, envelope, cash_balance) values
  ('00000000-0000-0000-0000-0000000f0a01', 'CTO A', 'investment', 'cto', 100),
  ('00000000-0000-0000-0000-0000000f0a02', 'CTO B', 'investment', 'cto', 0),
  ('00000000-0000-0000-0000-0000000f0a03', 'PEA P', 'investment', 'pea', 0);
insert into public.instruments (id, name, type, currency, price_source, source_symbol, last_price) values
  ('00000000-0000-0000-0000-0000000f0b01', 'Titre A', 'stock', 'EUR', 'manual', 'manual:fa', 150),
  ('00000000-0000-0000-0000-0000000f0b02', 'Titre B', 'stock', 'EUR', 'manual', 'manual:fb', 30),
  ('00000000-0000-0000-0000-0000000f0b03', 'Titre P', 'stock', 'EUR', 'manual', 'manual:fp', 80);
insert into public.positions (id, account_id, instrument_id, quantity, avg_cost) values
  ('00000000-0000-0000-0000-0000000f0c01', '00000000-0000-0000-0000-0000000f0a01', '00000000-0000-0000-0000-0000000f0b01', 10, 100),
  ('00000000-0000-0000-0000-0000000f0c02', '00000000-0000-0000-0000-0000000f0a02', '00000000-0000-0000-0000-0000000f0b02', 8, 50),
  ('00000000-0000-0000-0000-0000000f0c03', '00000000-0000-0000-0000-0000000f0a03', '00000000-0000-0000-0000-0000000f0b03', 5, 60);

do $$
declare
  r record; v_op uuid; v_div uuid; v_all uuid; v_cash numeric;
  a constant uuid := '00000000-0000-0000-0000-0000000f0a01';
  b constant uuid := '00000000-0000-0000-0000-0000000f0a02';
begin
  -- Vente partielle CTO A : 4 × 150, frais 2, PRU 100 → +198 ; reste 6 ; liquidités 100 + 598
  perform public.sell_position('00000000-0000-0000-0000-0000000f0c01', 4, 150, 2, '2026-06-01');
  select realized, avg_cost into r from public.operations where account_id = a and kind = 'sell';
  if r.realized <> 198 or r.avg_cost <> 100 then raise exception 'vente A : %', row_to_json(r); end if;
  if (select quantity from public.positions where id = '00000000-0000-0000-0000-0000000f0c01') <> 6 then raise exception 'quantité A'; end if;
  if (select cash_balance from public.manual_accounts where id = a) <> 698 then raise exception 'liquidités A'; end if;

  -- Vendre plus que détenu → refus, rien ne change
  begin
    perform public.sell_position('00000000-0000-0000-0000-0000000f0c01', 7, 150, 0, '2026-06-02');
    raise exception 'survente acceptée';
  exception when others then
    if sqlerrm not like 'Quantité vendue supérieure%' then raise; end if;
  end;
  if (select count(*) from public.operations where account_id = a) <> 1 then raise exception 'survente a laissé une trace'; end if;

  -- CTO B : 5 × 30, PRU 50 → −100 ; PEA : 2 × 80, PRU 60 → +40 (hors CTO)
  perform public.sell_position('00000000-0000-0000-0000-0000000f0c02', 5, 30, 0, '2026-09-01');
  perform public.sell_position('00000000-0000-0000-0000-0000000f0c03', 2, 80, 0, '2026-09-02');

  -- Dividende CTO A : 20 brut, 6 déjà prélevés → liquidités +14
  v_cash := (select cash_balance from public.manual_accounts where id = a);
  v_div := public.add_dividend(a, null, '2026-07-01', 20, 6, 'EUR', null);
  if (select cash_balance from public.manual_accounts where id = a) <> v_cash + 14 then raise exception 'dividende liquidités'; end if;

  -- Bilan 2026
  select * into r from public.tax_summary(2026);
  if r.cto_gains <> 198 or r.cto_losses <> -100 or r.cto_net <> 98 or r.cto_dividends <> 20
     or r.already_withheld <> 6 or r.estimated_tax <> 37.05 or r.remaining <> 31.05
     or r.pea_realized <> 40 or r.taxable <> 98 or r.loss_to_carry <> 0 or r.pfu_rate <> 0.314 then
    raise exception 'bilan : %', row_to_json(r);
  end if;

  -- Report de moins-values 150 → imposable 0, à reporter 52, impôt sur dividendes seuls
  insert into public.tax_settings (year, pfu_rate, carried_losses) values (2026, 0.314, 150);
  select * into r from public.tax_summary(2026);
  if r.taxable <> 0 or r.loss_to_carry <> 52 or r.estimated_tax <> 6.28 then raise exception 'report : %', row_to_json(r); end if;

  -- Année sans opération → tout à 0
  select * into r from public.tax_summary(2019);
  if r.cto_net <> 0 or r.estimated_tax <> 0 or r.remaining <> 0 or r.pea_realized <> 0 then raise exception 'année vide : %', row_to_json(r); end if;

  -- Vendre tout le reste de B (3) puis annuler → position recréée (3 @ 50), liquidités revenues
  v_cash := (select cash_balance from public.manual_accounts where id = b);
  v_all := public.sell_position('00000000-0000-0000-0000-0000000f0c02', 3, 40, 1, '2026-10-01');
  if exists (select 1 from public.positions where id = '00000000-0000-0000-0000-0000000f0c02') then raise exception 'position B non supprimée à 0'; end if;
  perform public.delete_operation(v_all);
  select quantity, avg_cost into r from public.positions where account_id = b and instrument_id = '00000000-0000-0000-0000-0000000f0b02';
  if r.quantity <> 3 or r.avg_cost <> 50 then raise exception 'annulation B : %', row_to_json(r); end if;
  if (select cash_balance from public.manual_accounts where id = b) <> v_cash then raise exception 'liquidités B après annulation'; end if;

  -- Annuler une vente alors que la position existe encore → fusion pondérée
  -- A : 6 @ 100 ; annule la vente de 4 @ PRU 100 → 10 @ 100
  select id into v_op from public.operations where account_id = a and kind = 'sell';
  perform public.delete_operation(v_op);
  select quantity, avg_cost into r from public.positions where id = '00000000-0000-0000-0000-0000000f0c01';
  if r.quantity <> 10 or r.avg_cost <> 100 then raise exception 'fusion A : %', row_to_json(r); end if;

  -- Annuler le dividende → liquidités −14
  v_cash := (select cash_balance from public.manual_accounts where id = a);
  perform public.delete_operation(v_div);
  if (select cash_balance from public.manual_accounts where id = a) <> v_cash - 14 then raise exception 'annulation dividende'; end if;

  -- Opération IBKR non supprimable
  insert into public.operations (account_id, kind, date, amount, currency, source, external_id)
  values (a, 'dividend', '2026-08-01', 1, 'USD', 'ibkr', 'T1') returning id into v_op;
  begin
    perform public.delete_operation(v_op);
    raise exception 'opération IBKR supprimée';
  exception when others then
    if sqlerrm not like 'Seules les opérations manuelles%' then raise; end if;
  end;
  -- Idempotence : même external_id refusé
  begin
    insert into public.operations (account_id, kind, date, amount, currency, source, external_id)
    values (a, 'dividend', '2026-08-01', 1, 'USD', 'ibkr', 'T1');
    raise exception 'doublon IBKR accepté';
  exception when unique_violation then null;
  end;
end $$;

select 'OK' as resultat;
rollback;
