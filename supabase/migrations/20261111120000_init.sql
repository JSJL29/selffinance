-- SelfFinance : schéma initial
-- Les données bancaires sont écrites uniquement par la fonction `sync` (clé service_role).
-- L'app ne fait que lire, sauf le solde saisi à la main.

create extension if not exists pg_cron;
create extension if not exists pg_net schema extensions;

-- Utilisateurs autorisés à lire les données (les inscriptions sont désactivées).
create table public.app_users (
  user_id uuid primary key references auth.users on delete cascade
);

create function public.is_app_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_users where user_id = auth.uid());
$$;

-- Sessions Enable Banking (une par banque, valables 90 à 180 jours).
create table public.bank_sessions (
  session_id  text primary key,
  bank        text not null,
  country     text not null default 'FR',
  valid_until timestamptz,
  created_at  timestamptz not null default now()
);

create table public.accounts (
  uid                 text primary key,               -- uid Enable Banking
  session_id          text references public.bank_sessions on delete set null,
  bank                text not null,
  name                text,                           -- « Compte courant », produit…
  iban                text,
  currency            text,
  balance             numeric,                        -- solde fourni par la banque (null si indisponible)
  balance_type        text,
  balance_at          timestamptz,
  manual_balance      numeric,                        -- solde de référence saisi dans l'app
  manual_balance_date date,                           -- … à la fin de cette journée
  hidden              boolean not null default false,
  last_sync_at        timestamptz,
  last_error          text,
  created_at          timestamptz not null default now()
);

create table public.transactions (
  id              bigint generated always as identity primary key,
  account_uid     text not null references public.accounts on delete cascade,
  entry_reference text,
  booking_date    date not null,
  value_date      date,
  amount          numeric not null,                   -- signé : négatif = sortie
  currency        text not null,
  counterparty    text,
  description     text,
  status          text,
  bank_code       text,
  is_internal     boolean not null default false,     -- virement entre mes comptes
  internal_label  text,
  raw             jsonb not null,
  created_at      timestamptz not null default now()
);
create index transactions_account_date on public.transactions (account_uid, booking_date desc);
create index transactions_date on public.transactions (booking_date desc);

-- Règles de détection des virements internes (regex insensible à la casse
-- sur « contrepartie + libellé »). direction : 'in', 'out' ou null (les deux).
create table public.internal_rules (
  id        serial primary key,
  pattern   text not null,
  label     text not null,
  direction text check (direction in ('in', 'out')),
  priority  int not null default 100
);

-- Taux BCE : 1 EUR = per_eur unités de la devise.
create table public.fx_rates (
  currency   text primary key,
  per_eur    numeric not null,
  updated_at timestamptz not null default now()
);
insert into public.fx_rates (currency, per_eur) values ('EUR', 1);

create table public.sync_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  log         jsonb
);

-- Classement automatique à l'écriture
create function public.classify_transaction() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_label text;
begin
  select r.label into v_label
  from public.internal_rules r
  where (coalesce(new.counterparty, '') || ' ' || coalesce(new.description, '')) ~* r.pattern
    and (r.direction is null or (r.direction = 'in') = (new.amount > 0))
  order by r.priority, r.id
  limit 1;
  new.is_internal := v_label is not null;
  new.internal_label := v_label;
  return new;
end $$;

create trigger transactions_classify
before insert or update of counterparty, description, amount on public.transactions
for each row execute function public.classify_transaction();

-- À relancer après avoir modifié internal_rules.
create function public.reclassify_all() returns integer
language plpgsql set search_path = '' as $$
declare n integer;
begin
  update public.transactions set description = description;
  get diagnostics n = row_count;
  return n;
end $$;

-- Remplace les transactions d'un compte à partir d'une date (les opérations
-- « en cours » changent souvent de référence en passant « comptabilisées »).
create function public.replace_transactions(p_account text, p_from date, p_rows jsonb)
returns integer
language plpgsql set search_path = '' as $$
declare n integer;
begin
  delete from public.transactions where account_uid = p_account and booking_date >= p_from;
  insert into public.transactions
    (account_uid, entry_reference, booking_date, value_date, amount, currency,
     counterparty, description, status, bank_code, raw)
  select p_account, r.entry_reference, r.booking_date, r.value_date, r.amount, r.currency,
         r.counterparty, r.description, r.status, r.bank_code, r.raw
  from jsonb_to_recordset(p_rows) as r(
    entry_reference text, booking_date date, value_date date, amount numeric, currency text,
    counterparty text, description text, status text, bank_code text, raw jsonb)
  where r.booking_date >= p_from;
  get diagnostics n = row_count;
  return n;
end $$;

-- Vues lues par l'app
create view public.account_view with (security_invoker = true) as
select
  a.uid, a.bank, a.name, a.iban, a.currency, a.hidden, a.last_sync_at, a.last_error,
  a.balance, a.balance_at, a.manual_balance, a.manual_balance_date,
  b.current_balance,
  case when a.manual_balance is not null then 'manual'
       when a.balance is not null then 'bank' end as balance_source,
  round(b.current_balance / coalesce(fx.per_eur, 1), 2) as balance_eur
from public.accounts a
left join public.fx_rates fx on fx.currency = a.currency
cross join lateral (
  -- un solde saisi à la main prime sur celui de la banque
  select case when a.manual_balance is not null then
    a.manual_balance + coalesce((
      select sum(t.amount) from public.transactions t
      where t.account_uid = a.uid and t.booking_date > a.manual_balance_date), 0)
  else a.balance end as current_balance
) b;

create view public.transaction_view with (security_invoker = true) as
select
  t.id, t.account_uid, t.booking_date, t.amount, t.currency, t.counterparty, t.description,
  t.status, t.is_internal, t.internal_label, a.bank, a.iban,
  round(t.amount / coalesce(fx.per_eur, 1), 2) as amount_eur
from public.transactions t
join public.accounts a on a.uid = t.account_uid
left join public.fx_rates fx on fx.currency = t.currency;

-- Sécurité : RLS partout, lecture réservée aux app_users.
alter table public.app_users      enable row level security;
alter table public.bank_sessions  enable row level security;
alter table public.accounts       enable row level security;
alter table public.transactions   enable row level security;
alter table public.internal_rules enable row level security;
alter table public.fx_rates       enable row level security;
alter table public.sync_runs      enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated, public;
grant execute on function public.is_app_user() to authenticated;

grant select on public.accounts, public.transactions, public.internal_rules,
                public.fx_rates, public.sync_runs, public.account_view, public.transaction_view
  to authenticated;
grant update (manual_balance, manual_balance_date, hidden) on public.accounts to authenticated;

create policy "lecture" on public.accounts       for select to authenticated using (public.is_app_user());
create policy "solde manuel" on public.accounts  for update to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy "lecture" on public.transactions   for select to authenticated using (public.is_app_user());
create policy "lecture" on public.internal_rules for select to authenticated using (public.is_app_user());
create policy "lecture" on public.fx_rates       for select to authenticated using (public.is_app_user());
create policy "lecture" on public.sync_runs      for select to authenticated using (public.is_app_user());

-- Règles génériques. Les règles propres à mes comptes (noms, numéros)
-- vivent dans supabase/private/rules.sql, hors git.
insert into public.internal_rules (pattern, label, direction) values
  ('Robo portfolio',        'Arrondis Robo portfolio', null),
  ('Fonds mon.taires',      'Fonds monétaires',        null),
  ('D.fi d.{1,2}.pargne',   'Défi d''épargne',         null),
  ('BQ CHAS',               'IBKR',                    null),
  ('BQ FTNO',               'Fortuneo',                null),
  ('BQ REVO',               'Revolut',                 null),
  ('VIR CPTE A CPTE',       'Virement entre comptes',  null);

-- Synchro automatique 3×/jour (6 h, 12 h, 19 h heure de Paris en hiver).
-- Les secrets `project_url` et `sync_secret` sont posés dans Vault à l'installation.
select cron.schedule('sync-banks', '0 5,11,18 * * *', $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000);
$cron$);
