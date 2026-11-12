-- Facultatif : ID de la Trade Confirmation Flex Query (Vault `ibkr_confirm_query_id`, période « Aujourd'hui »).
-- La fonction `ibkr` ajoute alors les ordres du jour au relevé de la veille.
create function public.ibkr_confirm_query_id() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'ibkr_confirm_query_id';
$$;
revoke execute on function public.ibkr_confirm_query_id() from public, anon, authenticated;
grant execute on function public.ibkr_confirm_query_id() to service_role;
