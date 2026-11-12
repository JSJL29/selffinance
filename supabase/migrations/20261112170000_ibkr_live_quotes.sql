-- Titres IBKR : cours Yahoo en direct (le relevé IBKR ne donne que la clôture de la veille).
-- `quote_symbol` = cotation Yahoo trouvée par ISIN dans la devise du PRU (fonction `quotes`).
-- `ticker` = symbole IBKR, repli quand Yahoo ne connaît pas l'ISIN (ex. Alphabet).
alter table public.instruments add column quote_symbol text;
alter table public.instruments add column ticker text;

-- Le rafraîchissement de 19 h inclut aussi les titres IBKR.
create or replace function public.run_quotes_refresh(p_force boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t timestamp := now() at time zone 'Europe/Paris';
begin
  if not p_force and (extract(isodow from t) >= 6 or extract(hour from t) <> 19) then
    return;
  end if;
  if not exists (select 1 from public.instruments where price_source in ('yahoo', 'amf', 'ibkr')) then
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
