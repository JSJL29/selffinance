-- Virements vers / depuis les comptes manuels (Livret A, PEA…).
-- Voir docs/superpowers/specs/2026-11-13-virements-internes-design.md
-- Solde affiché = solde saisi + virements bancaires correspondants arrivés après le jour de la saisie.
-- Calculé à la lecture : rien n'est stocké en double, la synchro peut réécrire les opérations sans risque.

alter table public.manual_accounts
  add column transfer_pattern text,                               -- texte cherché dans contrepartie + libellé
  add column transfers_from   date not null default current_date; -- virements comptés strictement après ce jour

-- Classement : le libellé d'un compte manuel passe avant les règles génériques.
create or replace function public.classify_transaction() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_label text;
  v_text  text := coalesce(new.counterparty, '') || ' ' || coalesce(new.description, '');
begin
  select m.name into v_label
  from public.manual_accounts m
  where m.sync_source is null
    and nullif(trim(m.transfer_pattern), '') is not null
    and strpos(lower(v_text), lower(trim(m.transfer_pattern))) > 0
  order by length(trim(m.transfer_pattern)) desc, m.id
  limit 1;

  if v_label is null then
    select r.label into v_label
    from public.internal_rules r
    where v_text ~* r.pattern
      and (r.direction is null or (r.direction = 'in') = (new.amount > 0))
    order by r.priority, r.id
    limit 1;
  end if;

  new.is_internal := v_label is not null;
  new.internal_label := v_label;
  return new;
end $$;

-- Un libellé ajouté, changé ou supprimé reclasse les opérations.
-- security definer : l'app n'a pas le droit d'écrire dans transactions.
create function public.reclassify_on_transfer_pattern() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.reclassify_all();
  return null;
end $$;
revoke execute on function public.reclassify_on_transfer_pattern() from public, anon, authenticated;

create trigger manual_accounts_transfer_pattern
after insert or delete or update of transfer_pattern, sync_source, name on public.manual_accounts
for each row execute function public.reclassify_on_transfer_pattern();

-- La vue reprend a.* : on la recrée (nouvelles colonnes), `transfers` en dernier.
drop view public.manual_account_view;
create view public.manual_account_view with (security_invoker = true) as
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
  -- dans la devise du compte ; un taux absent rend le total inconnu (null), jamais converti à 1
  select case
    when a.sync_source is not null or nullif(trim(a.transfer_pattern), '') is null then 0::numeric
    when count(c.v) < count(*) then null
    else coalesce(sum(c.v), 0)
  end as transfers
  from (
    select public.fx_convert(-t.amount, t.currency, a.currency) as v
    from public.transactions t
    where a.sync_source is null
      and nullif(trim(a.transfer_pattern), '') is not null
      and t.booking_date > a.transfers_from
      and strpos(lower(coalesce(t.counterparty, '') || ' ' || coalesce(t.description, '')), lower(trim(a.transfer_pattern))) > 0
  ) c
) tr;
grant select on public.manual_account_view to authenticated;

-- Les opérations existantes sont reclassées une fois (aucun libellé encore : sans effet, par sécurité).
select public.reclassify_all();
