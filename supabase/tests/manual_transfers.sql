-- Virements vers / depuis les comptes manuels. À exécuter tel quel : tout est annulé. Renvoie 'OK'.
begin;
delete from public.fx_rates where currency = 'ZZZ';
insert into public.accounts (uid, bank, currency, balance) values ('test-mt', 'Test', 'EUR', 0);
insert into public.manual_accounts (id, name, kind, envelope, currency, cash_balance, transfer_pattern, transfers_from) values
  ('00000000-0000-0000-0000-0000000004a1', 'Livret test', 'savings', 'livret', 'EUR', 1000, 'LIVRET TEST', '2026-01-10'),
  ('00000000-0000-0000-0000-0000000004a2', 'Livret vide', 'savings', 'livret', 'EUR', 500, '  ', '2026-01-10'),
  ('00000000-0000-0000-0000-0000000004a3', 'Livret devise', 'savings', 'livret', 'EUR', 10, 'ZZZTEST', '2026-01-10');
insert into public.transactions (account_uid, booking_date, amount, currency, description, raw) values
  ('test-mt', '2026-01-11', -300, 'EUR', 'VIR VERS LIVRET TEST', '{}'),
  ('test-mt', '2026-01-12', 100, 'EUR', 'VIR DE livret test', '{}'),
  ('test-mt', '2026-01-10', -50, 'EUR', 'VIR LIVRET TEST', '{}'),   -- jour de la saisie : déjà dans le solde
  ('test-mt', '2026-01-11', -999, 'EUR', 'CB CARREFOUR', '{}'),
  ('test-mt', '2026-01-11', -20, 'ZZZ', 'VIR ZZZTEST', '{}');

do $$
declare r record;
begin
  select transfers, cash_eur, value_eur into r from public.manual_account_view where id = '00000000-0000-0000-0000-0000000004a1';
  if r.transfers is distinct from 200 or r.cash_eur is distinct from 1200 or r.value_eur is distinct from 1200 then
    raise exception 'somme des virements : %', row_to_json(r);
  end if;

  if not exists (select 1 from public.transactions where account_uid = 'test-mt' and amount = -300
                 and is_internal and internal_label = 'Livret test') then
    raise exception 'virement vers le livret non classé interne';
  end if;
  if exists (select 1 from public.transactions where account_uid = 'test-mt' and amount = -999 and is_internal) then
    raise exception 'opération sans rapport classée interne';
  end if;

  if (select transfers from public.manual_account_view where id = '00000000-0000-0000-0000-0000000004a2') is distinct from 0 then
    raise exception 'libellé vide : virements comptés';
  end if;
  if (select transfers from public.manual_account_view where id = '00000000-0000-0000-0000-0000000004a3') is not null then
    raise exception 'taux absent replié sur une valeur';
  end if;

  -- Ré-enregistrer le formulaire (solde virements compris, départ = 12/01) : pas de double compte
  update public.manual_accounts set cash_balance = 1200, transfers_from = '2026-01-12'
  where id = '00000000-0000-0000-0000-0000000004a1';
  select transfers, cash_eur into r from public.manual_account_view where id = '00000000-0000-0000-0000-0000000004a1';
  if r.transfers is distinct from 0 or r.cash_eur is distinct from 1200 then
    raise exception 'ré-enregistrement : %', row_to_json(r);
  end if;

  -- Libellé retiré : les opérations sont reclassées
  update public.manual_accounts set transfer_pattern = null where id = '00000000-0000-0000-0000-0000000004a1';
  if exists (select 1 from public.transactions where account_uid = 'test-mt' and amount = -300 and internal_label = 'Livret test') then
    raise exception 'opérations non reclassées après changement de libellé';
  end if;
end $$;

select 'OK' as resultat;
rollback;
