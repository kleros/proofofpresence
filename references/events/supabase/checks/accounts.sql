-- Read-only: changes nothing. Run it in the Supabase SQL editor to check who has access.
-- The SQL editor shows the result of the last query only, so run one part at a time (select it, then Run).

-- 1. Every account with team or admin rights, plus the two known members.
--    confirm_delay near zero (under a few seconds) means the address was marked
--    confirmed in the same step that created the account: Confirm email was off at
--    that moment, or the account was made in the dashboard with auto-confirm.
--    has_password: a stored password (all email-link accounts have a random one
--    until 0014 clears them).
select u.email, u.created_at, u.confirmation_sent_at,
       u.email_confirmed_at - u.created_at as confirm_delay,
       coalesce(u.encrypted_password, '') <> '' as has_password,
       u.last_sign_in_at, p.is_team, p.is_admin, p.admin_by_sql
  from profiles p
  join auth.users u on u.id = p.id
 where p.is_team or p.is_admin
    or lower(u.email) in ('weiwei@kleros.io', 'francisco@kleros.io')
 order by p.is_admin desc, u.created_at;

-- 2. Accounts with an email that is not confirmed yet. Before 0014 runs, each of
--    these is open to the pre-registration takeover if it carries a password nobody
--    in the team set. An unconfirmed account cannot have signed in, so deleting one in
--    Authentication > Users loses nothing; the owner gets a new one at next sign-in.
select u.email, u.created_at, u.confirmation_sent_at,
       coalesce(u.encrypted_password, '') <> '' as has_password
  from auth.users u
 where u.email is not null and u.email_confirmed_at is null
 order by u.created_at desc;

-- 3. Live sessions that started with a password sign-in. The site never asks for a
--    password, so any row here was made by calling Supabase Auth directly.
--    (Rows disappear when that session signs out or expires.)
select u.email, p.is_team, p.is_admin, c.authentication_method, c.created_at as signed_in_at
  from auth.mfa_amr_claims c
  join auth.sessions s on s.id = c.session_id
  join auth.users u on u.id = s.user_id
  left join profiles p on p.id = u.id
 where c.authentication_method = 'password'
 order by c.created_at desc;

-- If part 3 lists anyone, end those sessions after 0014 has run (this one does change data):
--   delete from auth.sessions s using auth.mfa_amr_claims c
--    where c.session_id = s.id and c.authentication_method = 'password';
-- Do not block the address if it belongs to a real colleague: the password is already gone, and
-- blocking would lock them out too.
