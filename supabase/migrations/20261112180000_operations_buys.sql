-- Historique des achats (IBKR) et opérations provisoires (ordres du jour, remplacés par le relevé du lendemain).
alter table public.operations drop constraint operations_kind_check;
alter table public.operations add constraint operations_kind_check
  check (kind in ('buy', 'sell', 'dividend', 'withholding'));
alter table public.operations add column provisional boolean not null default false;

-- Même vue, avec la nouvelle colonne à la fin (create or replace n'accepte que des colonnes ajoutées en fin).
create or replace view public.operation_view with (security_invoker = true) as
select o.id, o.account_id, o.instrument_id, o.kind, o.date, o.quantity, o.price, o.fees, o.amount, o.tax_withheld,
       o.currency, o.avg_cost, o.realized, o.fx_per_eur, o.cash_credit, o.source, o.external_id, o.note, o.created_at,
       i.name as instrument_name, a.name as account_name, a.envelope,
       round(o.realized / o.fx_per_eur, 2) as realized_eur,
       round(o.amount / o.fx_per_eur, 2) as amount_eur,
       o.provisional
from public.operations o
join public.manual_accounts a on a.id = o.account_id
left join public.instruments i on i.id = o.instrument_id;
