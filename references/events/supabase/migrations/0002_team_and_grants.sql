-- Explicit API grants (newer Supabase projects may not expose tables by default)
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
grant insert on meeting_requests to anon;

-- Anyone signing in with an @kleros.io email is a Kleros team member.
-- Guests (anonymous sign-in, used for asking questions from a QR) have no email.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name, is_team)
  values (new.id, split_part(new.email, '@', 1), coalesce(lower(new.email) like '%@kleros.io', false));
  return new;
end $$;
