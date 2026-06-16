-- Allow null username so OAuth users can sign in before choosing a nickname
alter table public.profiles alter column username drop not null;

-- Update trigger: use nickname from metadata if present, otherwise null (OAuth flow)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_nickname text;
begin
  v_nickname := nullif(trim(coalesce(new.raw_user_meta_data->>'nickname', '')), '');
  insert into public.profiles (id, username)
  values (new.id, v_nickname);
  return new;
end;
$$;
