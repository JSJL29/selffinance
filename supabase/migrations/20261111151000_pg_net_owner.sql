-- Le compte du propriétaire devient app_user dès sa création
-- (créé à la main : Dashboard → Authentication → Add user).
-- Règle définitive (premier compte créé) : voir 20261111230000_owner_first_user.sql.
create function public.register_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.app_users) then
    insert into public.app_users (user_id) values (new.id);
  end if;
  return new;
end $$;
revoke execute on function public.register_owner() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.register_owner();
