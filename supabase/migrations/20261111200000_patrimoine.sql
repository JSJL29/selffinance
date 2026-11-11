-- Patrimoine : comptes manuels (livrets, PEA, CTO, AV, PER…), titres, positions.
-- Voir docs/superpowers/specs/2026-11-11-patrimoine-design.md

create table public.manual_accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  institution     text,
  kind            text not null check (kind in ('savings', 'investment')),
  envelope        text not null check (envelope in (
                    'livret_a', 'ldds', 'lep', 'livret', 'pea', 'pea_pme', 'cto',
                    'assurance_vie', 'per', 'epargne_salariale', 'crypto', 'autre')),
  currency        text not null default 'EUR',
  cash_balance    numeric not null default 0,   -- solde d'un livret, ou liquidités d'un compte titres
  cash_updated_at date,
  hidden          boolean not null default false,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);

-- Une ligne par cotation (un même ISIN peut être coté sur plusieurs places).
create table public.instruments (
  id               uuid primary key default gen_random_uuid(),
  isin             text,
  amf_code         text,
  name             text not null,
  type             text not null check (type in (
                     'stock', 'etf', 'fund', 'fcpe', 'fonds_euros', 'bond', 'crypto', 'other')),
  currency         text not null default 'EUR',
  price_source     text not null check (price_source in ('yahoo', 'amf', 'manual')),
  source_symbol    text,                         -- ticker Yahoo (CW8.PA) ou code AMF
  last_price       numeric,
  last_price_date  date,
  price_updated_at timestamptz,
  price_error      text,
  created_at       timestamptz not null default now(),
  unique nulls not distinct (isin, source_symbol)
);

-- Historique des cours (futurs graphiques).
create table public.instrument_prices (
  instrument_id uuid not null references public.instruments on delete cascade,
  date          date not null,
  price         numeric not null,
  primary key (instrument_id, date)
);

create table public.positions (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.manual_accounts on delete cascade,
  instrument_id uuid not null references public.instruments on delete restrict,
  quantity      numeric not null,
  avg_cost      numeric not null,                -- PRU
  cost_currency text not null default 'EUR',
  updated_at    timestamptz not null default now(),
  unique (account_id, instrument_id)
);
create index positions_instrument on public.positions (instrument_id);

-- Sécurité : lecture/écriture réservées au propriétaire.
do $$
declare t text;
begin
  foreach t in array array['manual_accounts', 'instruments', 'instrument_prices', 'positions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy "proprietaire" on public.%I for all to authenticated
                    using (public.is_app_user()) with check (public.is_app_user())', t);
  end loop;
end $$;

-- Valeurs en EUR. Taux absent de fx_rates => null (pas de repli à 1).
create view public.position_view with (security_invoker = true) as
select
  p.id, p.account_id, p.instrument_id, p.quantity, p.avg_cost, p.cost_currency, p.updated_at,
  i.name as instrument_name, i.isin, i.type, i.price_source, i.source_symbol,
  i.currency as instrument_currency, i.last_price, i.last_price_date, i.price_error,
  v.value_eur, c.invested_eur,
  v.value_eur - c.invested_eur as pnl_eur,
  case when c.invested_eur > 0 then (v.value_eur - c.invested_eur) / c.invested_eur end as pnl_pct
from public.positions p
join public.instruments i on i.id = p.instrument_id
left join public.fx_rates fi on fi.currency = i.currency
left join public.fx_rates fc on fc.currency = p.cost_currency
cross join lateral (select round(p.quantity * i.last_price / fi.per_eur, 2) as value_eur) v
cross join lateral (select round(p.quantity * p.avg_cost / fc.per_eur, 2) as invested_eur) c;

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
  -- seules les lignes valorisées comptent dans les totaux
  select
    sum(pv.value_eur) filter (where pv.value_eur is not null and pv.invested_eur is not null) as positions_value_eur,
    sum(pv.invested_eur) filter (where pv.value_eur is not null and pv.invested_eur is not null) as invested_eur,
    sum(pv.pnl_eur) as pnl_eur,
    count(*) filter (where pv.value_eur is null or pv.invested_eur is null)::int as missing_prices,
    count(*)::int as positions
  from public.position_view pv where pv.account_id = a.id
) s on true;

grant select on public.position_view, public.manual_account_view to authenticated;
