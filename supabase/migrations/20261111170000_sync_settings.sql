-- Réglages de synchro modifiables dans l'app : heures des synchros automatiques
-- (heure de Paris, 0 à 4 par jour). Le reste du budget de 4 accès/jour
-- (limite DSP2) est disponible pour les synchros manuelles.
create table public.sync_settings (
  id         boolean primary key default true check (id),
  auto_hours smallint[] not null default '{6,12,19}'
    check (cardinality(auto_hours) <= 4
           and auto_hours <@ '{0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23}'::smallint[]),
  updated_at timestamptz not null default now()
);
insert into public.sync_settings default values;

alter table public.sync_settings enable row level security;
grant select on public.sync_settings to authenticated;
grant update (auto_hours, updated_at) on public.sync_settings to authenticated;
create policy "lecture" on public.sync_settings for select to authenticated using (public.is_app_user());
create policy "modif" on public.sync_settings for update to authenticated
  using (public.is_app_user()) with check (public.is_app_user());

-- Budget du jour (heure de Paris).
create function public.sync_budget()
returns table (daily_limit int, used int, auto_left int, manual_left int, next_auto int)
language sql stable set search_path = '' as $$
  with p as (select now() at time zone 'Europe/Paris' as ts),
  s as (select auto_hours from public.sync_settings where id),
  u as (
    select count(*)::int as n from public.sync_runs r, p
    where (r.started_at at time zone 'Europe/Paris')::date = p.ts::date
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
revoke execute on function public.sync_budget() from public, anon;
grant execute on function public.sync_budget() to authenticated, service_role;

drop function public.manual_syncs_today();

-- Appelée chaque heure par pg_cron : lance la synchro si l'heure est prévue
-- et que le budget du jour n'est pas épuisé.
create function public.run_scheduled_sync() returns void
language plpgsql security definer set search_path = '' as $$
declare
  h int := extract(hour from now() at time zone 'Europe/Paris');
begin
  if not exists (select 1 from public.sync_settings where id and h = any(auto_hours)) then
    return;
  end if;
  if (select used from public.sync_budget()) >= 4 then
    return;
  end if;
  perform net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000);
end $$;
revoke execute on function public.run_scheduled_sync() from public, anon, authenticated;

select cron.unschedule('sync-banks');
select cron.schedule('sync-banks', '0 * * * *', 'select public.run_scheduled_sync()');
