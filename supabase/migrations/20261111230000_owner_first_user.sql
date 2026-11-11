-- Propriétaire = le premier compte créé (plus d'e-mail écrit en dur), pour que chacun
-- puisse déployer sa propre copie. Les comptes suivants n'ont accès à rien.
create or replace function public.register_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Verrou : deux inscriptions simultanées ne peuvent pas devenir propriétaires toutes les deux.
  lock table public.app_users in exclusive mode;
  if not exists (select 1 from public.app_users) then
    insert into public.app_users (user_id) values (new.id);
  end if;
  return new;
end $$;
revoke execute on function public.register_owner() from public, anon, authenticated;
