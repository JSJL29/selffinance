-- Connexion / reconnexion d'une banque depuis l'app (fonction `bank`).

-- Demandes de connexion en cours (state OAuth), lues uniquement par la fonction.
create table public.bank_auth_requests (
  state       uuid primary key,
  bank        text not null,
  country     text not null,
  return_to   text not null,
  user_id     uuid not null references auth.users on delete cascade,
  created_at  timestamptz not null default now(),
  consumed_at timestamptz
);
alter table public.bank_auth_requests enable row level security;

-- Une reconnexion donne de nouveaux uid de comptes : on renomme l'ancien compte
-- pour garder son historique.
alter table public.transactions drop constraint transactions_account_uid_fkey;
alter table public.transactions add constraint transactions_account_uid_fkey
  foreign key (account_uid) references public.accounts (uid) on update cascade on delete cascade;

-- Synchro initiale d'une banque juste connectée : l'utilisateur est présent,
-- elle ne compte pas dans le budget de 4 accès/jour.
alter table public.sync_runs drop constraint sync_runs_trigger_check;
alter table public.sync_runs add constraint sync_runs_trigger_check
  check (trigger in ('cron', 'manual', 'connect'));

create or replace function public.sync_budget()
returns table (daily_limit int, used int, auto_left int, manual_left int, next_auto int)
language sql stable set search_path = '' as $$
  with p as (select now() at time zone 'Europe/Paris' as ts),
  s as (select auto_hours from public.sync_settings where id),
  u as (
    select count(*)::int as n from public.sync_runs r, p
    where r.trigger in ('cron', 'manual')
      and (r.started_at at time zone 'Europe/Paris')::date = p.ts::date
  ),
  a as (
    select count(*)::int as n, min(h)::int as nxt
    from s, p, unnest(s.auto_hours) as h
    where h > extract(hour from p.ts)
  )
  select 4, u.n, a.n, greatest(0, 4 - u.n - a.n),
         coalesce(a.nxt, (select min(h)::int from s, unnest(s.auto_hours) as h))
  from u, a;
$$;

-- Enregistre une session Enable Banking. p = { session_id, bank, country, valid_until,
-- accounts: [{ uid, iban, currency, name }] }. Renvoie les uid des comptes nouveaux.
create function public.adopt_bank_session(p jsonb) returns text[]
language plpgsql set search_path = '' as $$
declare
  v_bank text := p->>'bank';
  v_sid  text := p->>'session_id';
  acc    jsonb;
  v_uid  text;
  v_iban text;
  v_cur  text;
  v_old  text;
  v_new  text[] := '{}';
begin
  insert into public.bank_sessions (session_id, bank, country, valid_until)
  values (v_sid, v_bank, coalesce(p->>'country', 'FR'), (p->>'valid_until')::timestamptz)
  on conflict (session_id) do update set valid_until = excluded.valid_until;

  for acc in select * from jsonb_array_elements(p->'accounts') loop
    v_uid  := acc->>'uid';
    v_iban := nullif(acc->>'iban', '');
    v_cur  := nullif(nullif(acc->>'currency', ''), 'XXX');
    v_old  := null;

    if exists (select 1 from public.accounts where uid = v_uid) then
      update public.accounts set session_id = v_sid, last_error = null where uid = v_uid;
      continue;
    end if;

    if v_iban is not null then
      -- même banque + même IBAN (+ même devise : Revolut a un compte par devise)
      select uid into v_old from public.accounts
      where bank = v_bank and iban = v_iban and currency is not distinct from v_cur
      limit 1;
      if v_old is null and v_cur is null then
        select uid into v_old from public.accounts
        where bank = v_bank and iban = v_iban
          and (select count(*) from public.accounts a2 where a2.bank = v_bank and a2.iban = v_iban) = 1;
      end if;
    end if;

    if v_old is not null then
      update public.accounts set uid = v_uid, session_id = v_sid, last_error = null where uid = v_old;
    else
      insert into public.accounts (uid, bank, session_id, name, iban, currency)
      values (v_uid, v_bank, v_sid, nullif(acc->>'name', ''), v_iban, v_cur);
      v_new := v_new || v_uid;
    end if;
  end loop;

  -- Les anciennes sessions de cette banque qui n'ont plus de compte disparaissent.
  delete from public.bank_sessions s
  where s.bank = v_bank and s.session_id <> v_sid
    and not exists (select 1 from public.accounts a where a.session_id = s.session_id);

  return v_new;
end $$;
revoke execute on function public.adopt_bank_session(jsonb) from public, anon, authenticated;
grant execute on function public.adopt_bank_session(jsonb) to service_role;

-- L'app affiche la date d'expiration du consentement de chaque compte.
grant select on public.bank_sessions to authenticated;
create policy "lecture" on public.bank_sessions for select to authenticated using (public.is_app_user());

create or replace view public.account_view with (security_invoker = true) as
select
  a.uid, a.bank, a.name, a.iban, a.currency, a.hidden, a.last_sync_at, a.last_error,
  a.balance, a.balance_at, a.manual_balance, a.manual_balance_date,
  b.current_balance,
  case when a.manual_balance is not null then 'manual'
       when a.balance is not null then 'bank' end as balance_source,
  round(b.current_balance / coalesce(fx.per_eur, 1), 2) as balance_eur,
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
