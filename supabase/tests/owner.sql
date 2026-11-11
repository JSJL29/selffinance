-- Le premier compte créé devient propriétaire ; les suivants n'ont accès à rien.
-- À exécuter tel quel : tout est annulé. Renvoie 'OK'.
begin;
delete from public.app_users;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000aa01', 'premier@test.local', 'authenticated', 'authenticated');
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000aa02', 'second@test.local', 'authenticated', 'authenticated');

do $$ begin
  if not exists (select 1 from public.app_users where user_id = '00000000-0000-0000-0000-00000000aa01') then
    raise exception 'le premier compte n''est pas propriétaire';
  end if;
  if exists (select 1 from public.app_users where user_id = '00000000-0000-0000-0000-00000000aa02') then
    raise exception 'le second compte est devenu propriétaire';
  end if;
end $$;

select 'OK' as resultat;
rollback;
