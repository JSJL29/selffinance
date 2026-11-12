-- Test du schéma IBKR. À exécuter tel quel : tout est annulé. Renvoie 'OK'.
begin;
insert into public.manual_accounts (id, name, kind, envelope, sync_source)
values ('00000000-0000-0000-0000-0000000001b1', 'CTO IBKR', 'investment', 'cto', 'ibkr');
insert into public.instruments (id, name, type, currency, price_source, source_symbol, last_price)
values ('00000000-0000-0000-0000-0000000001c1', 'Apple', 'stock', 'USD', 'ibkr', 'ibkr:265598', 200);

do $$
declare r record;
begin
  -- La vue expose la source de synchro et son état
  select sync_source, last_synced_at, sync_error into r from public.manual_account_view
  where id = '00000000-0000-0000-0000-0000000001b1';
  if r.sync_source is distinct from 'ibkr' then raise exception 'vue : %', row_to_json(r); end if;

  -- Une seule source de synchro autorisée
  begin
    insert into public.manual_accounts (name, kind, envelope, sync_source) values ('x', 'investment', 'cto', 'autre');
    raise exception 'sync_source inconnue acceptée';
  exception when check_violation then null;
  end;

  -- Config IBKR lisible par service_role uniquement
  if has_function_privilege('authenticated', 'public.ibkr_config()', 'execute') then
    raise exception 'ibkr_config exécutable par authenticated';
  end if;
  if has_function_privilege('authenticated', 'public.ibkr_confirm_query_id()', 'execute') then
    raise exception 'ibkr_confirm_query_id exécutable par authenticated';
  end if;
end $$;

select 'OK' as resultat;
rollback;
