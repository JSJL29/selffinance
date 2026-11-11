-- Config de la fonction `sync` lue depuis Vault (réservée à service_role).
-- Secrets Vault posés à l'installation : project_url, sync_secret, eb_app_id.
create function public.sync_config()
returns table (sync_secret text, eb_app_id text)
language sql stable security definer set search_path = '' as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'eb_app_id');
$$;
revoke execute on function public.sync_config() from public, anon, authenticated;
grant execute on function public.sync_config() to service_role;
