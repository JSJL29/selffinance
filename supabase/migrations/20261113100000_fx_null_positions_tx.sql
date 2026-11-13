-- 1) Comptes bancaires : un taux de change absent donne null (plus de repli à 1, qui comptait 1 $ = 1 €).
create or replace view public.account_view with (security_invoker = true) as
select
  a.uid, a.bank, a.name, a.iban, a.currency, a.hidden, a.last_sync_at, a.last_error,
  a.balance, a.balance_at, a.manual_balance, a.manual_balance_date,
  b.current_balance,
  case when a.manual_balance is not null then 'manual'
       when a.balance is not null then 'bank' end as balance_source,
  round(b.current_balance / fx.per_eur, 2) as balance_eur,
  s.valid_until as consent_until
from public.accounts a
left join public.fx_rates fx on fx.currency = a.currency
left join public.bank_sessions s on s.session_id = a.session_id
cross join lateral (
  select case when a.manual_balance is not null then
    a.manual_balance + coalesce((
      select sum(t.amount) from public.transactions t
      where t.account_uid = a.uid and t.booking_date > a.manual_balance_date), 0)
  else a.balance end as current_balance
) b;

create or replace view public.transaction_view with (security_invoker = true) as
select
  t.id, t.account_uid, t.booking_date, t.amount, t.currency, t.counterparty, t.description,
  t.status, t.is_internal, t.internal_label, a.bank, a.iban,
  round(t.amount / fx.per_eur, 2) as amount_eur
from public.transactions t
join public.accounts a on a.uid = t.account_uid
left join public.fx_rates fx on fx.currency = t.currency;

-- 2) Synchro IBKR : positions du compte remplacées en une seule transaction
--    (avant : suppression puis insertion séparées, un échec laissait le compte vide).
--    p_rows = [{ instrument_id, quantity, avg_cost, cost_currency }]
create function public.replace_positions(p_account uuid, p_rows jsonb) returns integer
language plpgsql set search_path = '' as $$
declare n integer;
begin
  delete from public.positions where account_id = p_account;
  insert into public.positions (account_id, instrument_id, quantity, avg_cost, cost_currency)
  select p_account, r.instrument_id, r.quantity, r.avg_cost, r.cost_currency
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
    as r(instrument_id uuid, quantity numeric, avg_cost numeric, cost_currency text);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.replace_positions(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_positions(uuid, jsonb) to service_role;
