-- Synchro manuelle depuis l'app, limitée pour rester sous les 4 accès/jour DSP2
-- (3 synchros cron + 1 manuelle).
alter table public.sync_runs add column trigger text not null default 'cron'
  check (trigger in ('cron', 'manual'));

create function public.manual_syncs_today() returns integer
language sql stable set search_path = '' as $$
  select count(*)::int from public.sync_runs
  where trigger = 'manual'
    and (started_at at time zone 'Europe/Paris')::date = (now() at time zone 'Europe/Paris')::date;
$$;
revoke execute on function public.manual_syncs_today() from public, anon;
grant execute on function public.manual_syncs_today() to authenticated, service_role;
