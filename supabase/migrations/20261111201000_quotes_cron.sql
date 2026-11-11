-- Mise à jour des cours du Patrimoine : jours ouvrés, 19 h heure de Paris.
-- Appelée chaque heure par pg_cron ; ne fait rien en dehors du créneau.
create function public.run_quotes_refresh(p_force boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t timestamp := now() at time zone 'Europe/Paris';
begin
  if not p_force and (extract(isodow from t) >= 6 or extract(hour from t) <> 19) then
    return;
  end if;
  if not exists (select 1 from public.instruments where price_source in ('yahoo', 'amf')) then
    return;
  end if;
  perform net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/quotes/refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000);
end $$;
revoke execute on function public.run_quotes_refresh(boolean) from public, anon, authenticated;

select cron.schedule('refresh-quotes', '0 * * * *', 'select public.run_quotes_refresh()');
