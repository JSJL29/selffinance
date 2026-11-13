-- Correctifs de la relecture des virements vers les comptes manuels (voir 20261113150000_manual_transfers.sql).

-- 1) Libellé d'au moins 4 caractères : « PEA » capterait « PÉAGE APRR », « A » presque tout.
alter table public.manual_accounts add constraint manual_accounts_transfer_pattern_len
  check (transfer_pattern is null or length(trim(transfer_pattern)) = 0 or length(trim(transfer_pattern)) >= 4);

-- 2) Reclasser seulement quand ça change quelque chose (avant : à chaque enregistrement du formulaire,
--    toute la table transactions était réécrite).
drop trigger manual_accounts_transfer_pattern on public.manual_accounts;

create trigger manual_accounts_transfer_pattern_ins
after insert on public.manual_accounts for each row
when (nullif(trim(new.transfer_pattern), '') is not null)
execute function public.reclassify_on_transfer_pattern();

create trigger manual_accounts_transfer_pattern_upd
after update on public.manual_accounts for each row
when (old.transfer_pattern is distinct from new.transfer_pattern
      or (nullif(trim(new.transfer_pattern), '') is not null
          and (old.name is distinct from new.name or old.sync_source is distinct from new.sync_source)))
execute function public.reclassify_on_transfer_pattern();

create trigger manual_accounts_transfer_pattern_del
after delete on public.manual_accounts for each row
when (nullif(trim(old.transfer_pattern), '') is not null)
execute function public.reclassify_on_transfer_pattern();

-- 3) Une opération ne compte que pour un seul compte : celui dont le libellé est le plus long
--    (même choix que classify_transaction). Avant, « LIVRET » et « LIVRET A » la comptaient tous les deux.
create or replace view public.manual_account_view with (security_invoker = true) as
select
  a.*,
  round((a.cash_balance + tr.transfers) / fx.per_eur, 2) as cash_eur,
  coalesce(s.positions_value_eur, 0) as positions_value_eur,
  coalesce(s.invested_eur, 0) as invested_eur,
  coalesce(s.pnl_eur, 0) as pnl_eur,
  case when s.invested_eur > 0 then s.pnl_eur / s.invested_eur end as pnl_pct,
  round((a.cash_balance + tr.transfers) / fx.per_eur, 2) + coalesce(s.positions_value_eur, 0) as value_eur,
  coalesce(s.missing_prices, 0) as missing_prices,
  coalesce(s.positions, 0) as positions,
  tr.transfers
from public.manual_accounts a
left join public.fx_rates fx on fx.currency = a.currency
left join lateral (
  select
    sum(pv.value_eur) filter (where pv.value_eur is not null and pv.invested_eur is not null) as positions_value_eur,
    sum(pv.invested_eur) filter (where pv.value_eur is not null and pv.invested_eur is not null) as invested_eur,
    sum(pv.pnl_eur) as pnl_eur,
    count(*) filter (where pv.value_eur is null or pv.invested_eur is null)::int as missing_prices,
    count(*)::int as positions
  from public.position_view pv where pv.account_id = a.id
) s on true
cross join lateral (
  select case
    when a.sync_source is not null or nullif(trim(a.transfer_pattern), '') is null then 0::numeric
    when count(c.v) < count(*) then null
    else coalesce(sum(c.v), 0)
  end as transfers
  from (
    select public.fx_convert(-t.amount, t.currency, a.currency) as v
    from public.transactions t
    cross join lateral (select lower(coalesce(t.counterparty, '') || ' ' || coalesce(t.description, '')) as txt) x
    where a.sync_source is null
      and nullif(trim(a.transfer_pattern), '') is not null
      and t.booking_date > a.transfers_from
      and strpos(x.txt, lower(trim(a.transfer_pattern))) > 0
      and not exists (
        select 1 from public.manual_accounts m
        where m.id <> a.id and m.sync_source is null
          and nullif(trim(m.transfer_pattern), '') is not null
          and strpos(x.txt, lower(trim(m.transfer_pattern))) > 0
          and (length(trim(m.transfer_pattern)) > length(trim(a.transfer_pattern))
               or (length(trim(m.transfer_pattern)) = length(trim(a.transfer_pattern)) and m.id < a.id))
      )
  ) c
) tr;
