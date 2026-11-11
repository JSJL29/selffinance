-- Le compte du propriétaire devient app_user dès sa création
-- (créé à la main : Dashboard → Authentication → Add user).
create function public.register_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if lower(new.email) = '<ton-email>' then
    insert into public.app_users (user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.register_owner() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.register_owner();

insert into public.app_users (user_id)
select id from auth.users where lower(email) = '<ton-email>'
on conflict do nothing;
