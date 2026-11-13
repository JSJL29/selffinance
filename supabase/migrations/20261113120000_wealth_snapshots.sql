-- Historique du patrimoine : photo quotidienne (22 h, heure de Paris) de la valeur de chaque compte.
-- Voir docs/superpowers/specs/2026-11-13-historique-patrimoine-design.md
-- La photo ne lit que la base (aucun accès bancaire, hors budget DSP2).

create table public.wealth_snapshots (
  date         date not null,
  -- reconnexion bancaire : l'uid change (adopt_bank_session), l'historique suit
  bank_uid     text references public.accounts (uid) on update cascade on delete cascade,
  manual_id    uuid references public.manual_accounts (id) on delete cascade,
  value_eur    numeric,                 -- null : taux de change ou cours manquant
  invested_eur numeric,                 -- placements seulement
  missing      int not null default 0,  -- positions sans cours/taux ce jour-là
  created_at   timestamptz not null default now(),
  check (num_nonnulls(bank_uid, manual_id) = 1),
  unique (date, bank_uid),
  unique (date, manual_id)
);
create index wealth_snapshots_date on public.wealth_snapshots (date);

alter table public.wealth_snapshots enable row level security;
grant select on public.wealth_snapshots to authenticated;
create policy "lecture" on public.wealth_snapshots for select to authenticated using (public.is_app_user());

-- Photo d'un jour (relançable : remplace les lignes du jour). Mêmes chiffres que l'écran.
create function public.take_wealth_snapshot(p_date date default (now() at time zone 'Europe/Paris')::date)
returns integer language plpgsql set search_path = '' as $$
declare n integer; m integer;
begin
  delete from public.wealth_snapshots where date = p_date;
  insert into public.wealth_snapshots (date, bank_uid, value_eur)
  select p_date, a.uid, a.balance_eur from public.account_view a;
  get diagnostics n = row_count;
  insert into public.wealth_snapshots (date, manual_id, value_eur, invested_eur, missing)
  select p_date, a.id, a.value_eur,
         case when a.kind = 'investment' then a.invested_eur end,
         a.missing_prices
  from public.manual_account_view a;
  get diagnostics m = row_count;
  return n + m;
end $$;
revoke execute on function public.take_wealth_snapshot(date) from public, anon, authenticated;
grant execute on function public.take_wealth_snapshot(date) to service_role;

-- Appelée chaque heure par pg_cron : photo à 22 h heure de Paris (été comme hiver).
create function public.run_wealth_snapshot(p_force boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not p_force and extract(hour from now() at time zone 'Europe/Paris') <> 22 then
    return;
  end if;
  perform public.take_wealth_snapshot();
end $$;
revoke execute on function public.run_wealth_snapshot(boolean) from public, anon, authenticated;

select cron.schedule('wealth-snapshot', '0 * * * *', 'select public.run_wealth_snapshot()');

-- Premier point dès la mise en service.
select public.take_wealth_snapshot();
