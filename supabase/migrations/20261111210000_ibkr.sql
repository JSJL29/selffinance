-- IBKR automatique (Flex Web Service) : compte synchronisé, titres « ibkr », cron 7 h.

alter table public.manual_accounts
  add column sync_source    text check (sync_source in ('ibkr')),
  add column last_synced_at timestamptz,
  add column sync_error     text;

alter table public.instruments drop constraint instruments_price_source_check;
alter table public.instruments add constraint instruments_price_source_check
  check (price_source in ('yahoo', 'amf', 'manual', 'ibkr'));

-- ID de la Flex Query (Vault `ibkr_query_id`), lu par la fonction `ibkr`.
create function public.ibkr_config() returns table (query_id text)
language sql stable security definer set search_path = '' as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'ibkr_query_id');
$$;
revoke execute on function public.ibkr_config() from public, anon, authenticated;
grant execute on function public.ibkr_config() to service_role;

-- La vue reprend a.* : on la recrée pour exposer les nouvelles colonnes.
drop view public.manual_account_view;
create view public.manual_account_view with (security_invoker = true) as
select
  a.*,
  round(a.cash_balance / fx.per_eur, 2) as cash_eur,
  coalesce(s.positions_value_eur, 0) as positions_value_eur,
  coalesce(s.invested_eur, 0) as invested_eur,
  coalesce(s.pnl_eur, 0) as pnl_eur,
  case when s.invested_eur > 0 then s.pnl_eur / s.invested_eur end as pnl_pct,
  round(a.cash_balance / fx.per_eur, 2) + coalesce(s.positions_value_eur, 0) as value_eur,
  coalesce(s.missing_prices, 0) as missing_prices,
  coalesce(s.positions, 0) as positions
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
) s on true;
grant select on public.manual_account_view to authenticated;

-- Cron : tous les jours à 7 h (heure de Paris), si l'ID de requête est configuré.
create function public.run_ibkr_sync(p_force boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not p_force and extract(hour from now() at time zone 'Europe/Paris') <> 7 then
    return;
  end if;
  if (select query_id from public.ibkr_config()) is null then
    return;
  end if;
  perform net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/ibkr/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000);
end $$;
revoke execute on function public.run_ibkr_sync(boolean) from public, anon, authenticated;

select cron.schedule('sync-ibkr', '0 * * * *', 'select public.run_ibkr_sync()');
