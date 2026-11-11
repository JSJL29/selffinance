-- Le jeton Flex IBKR peut aussi être rangé dans Vault (`ibkr_token`), à côté de `ibkr_query_id`.
-- La fonction `ibkr` utilise en priorité le secret de fonction IBKR_FLEX_TOKEN s'il existe.
create function public.ibkr_token() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'ibkr_token';
$$;
revoke execute on function public.ibkr_token() from public, anon, authenticated;
grant execute on function public.ibkr_token() to service_role;
