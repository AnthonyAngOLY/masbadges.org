-- 20261010100000_instructor_directory_opt_in.sql
--
-- Makes the public instructor directory actually work. As of 2026-09-04 it was
-- inert in all three layers at once, verified against the live database:
--
--   * AccountSettings.tsx calls get_my_instructor_listing() and
--     set_my_instructor_listing(_on). NEITHER FUNCTION EXISTS. The read
--     discards its error, so the switch showed "Not listed" for everyone; the
--     write surfaced a raw "function not found".
--   * memberships has no consent column, so there was nowhere to record a
--     decision even if the functions had existed.
--   * instructor_directory returned 0 rows against 3 active instructor
--     memberships, so /instructors showed an empty list.
--
-- Nobody was ever published without consent — nobody was published at all.
--
-- WHAT THIS CHANGES
--   1. memberships gains public_listing (consent, default FALSE) and two
--      optional self-supplied public contact fields.
--   2. instructor_directory is rebuilt to honour consent, and to expose the
--      `independent` flag the frontend has always read but the view never had.
--   3. The two missing RPCs are created, with the exact signatures the frontend
--      already calls.
--
-- NOTE ON REPLACING THE VIEW
-- This drops and recreates instructor_directory. The deployed definition was
-- never captured into git and may differ from the committed one (see
-- "The migrations folder is NOT the live schema" in CLAUDE.md). Replacing it is
-- safe here precisely because the feature is provably non-functional: the view
-- returns nothing and no consent data exists to preserve. If you want the old
-- definition on record first, run supabase/diagnostics/dump_live_schema.sql
-- PART 7 before applying this.
--
-- DEFAULT IS OFF. Every existing instructor stays unlisted until they opt in,
-- so applying this publishes nobody.
--
-- Blacklisted instructors remain EXCLUDED, unchanged from the original design
-- ("internal record + reason — no public shaming"). Publishing enforcement
-- status is a separate decision and is deliberately not made here.

-- ---------------------------------------------------------------------------
-- 1. Consent + optional public contact
-- ---------------------------------------------------------------------------
alter table public.memberships
  add column if not exists public_listing boolean not null default false;

-- Deliberately NOT profiles.email/phone: that is the login address. An
-- instructor who wants to be contactable supplies a separate public one.
alter table public.memberships
  add column if not exists public_contact_email text;

alter table public.memberships
  add column if not exists public_contact_phone text;

comment on column public.memberships.public_listing is
  'Instructor consent to appear in the public instructor_directory. Default false.';
comment on column public.memberships.public_contact_email is
  'Optional public contact address, shown only while public_listing is true.';
comment on column public.memberships.public_contact_phone is
  'Optional public contact number, shown only while public_listing is true.';

-- ---------------------------------------------------------------------------
-- 2. The public view — consent-gated
-- ---------------------------------------------------------------------------
drop view if exists public.instructor_directory;

create view public.instructor_directory as
select
  m.profile_id,
  p.full_name,
  m.state,
  m.partner_center_id,
  pc.name                            as centre_name,
  (m.partner_center_id is null)      as independent,
  m.public_contact_email,
  m.public_contact_phone
from public.memberships m
join public.profiles p on p.id = m.profile_id
left join public.partner_centers pc on pc.id = m.partner_center_id
where m.role = 'instructor'
  and m.status = 'active'
  and m.public_listing is true                       -- the consent gate
  and (m.expires_at is null or m.expires_at >= current_date)
  and not exists (
    select 1 from public.instructor_blacklist b
    where b.profile_id = p.id and b.lifted_at is null
  );

grant select on public.instructor_directory to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The two RPCs the frontend already calls
-- ---------------------------------------------------------------------------

-- Returns the caller's own consent flag. Null when they hold no active
-- instructor membership, which the UI renders as "not listed".
create or replace function public.get_my_instructor_listing()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select bool_or(m.public_listing)
  from public.memberships m
  where m.profile_id = (select auth.uid())
    and m.role = 'instructor'
    and m.status = 'active';
$function$;

-- Sets it. Own rows only: auth.uid() is the filter, so this cannot list or
-- unlist anyone else, and it touches no other column.
create or replace function public.set_my_instructor_listing(_on boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  touched integer;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;

  update public.memberships
     set public_listing = coalesce(_on, false),
         updated_at     = now()
   where profile_id = (select auth.uid())
     and role       = 'instructor'
     and status     = 'active';

  get diagnostics touched = row_count;
  if touched = 0 then
    raise exception 'no active instructor membership for this account';
  end if;
end;
$function$;

-- Optional public contact details, same own-rows-only rule. The frontend does
-- not call this yet; the directory simply shows nothing when both are null.
create or replace function public.set_my_public_contact(_email text, _phone text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  touched integer;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;

  update public.memberships
     set public_contact_email = nullif(btrim(coalesce(_email, '')), ''),
         public_contact_phone = nullif(btrim(coalesce(_phone, '')), ''),
         updated_at           = now()
   where profile_id = (select auth.uid())
     and role       = 'instructor'
     and status     = 'active';

  get diagnostics touched = row_count;
  if touched = 0 then
    raise exception 'no active instructor membership for this account';
  end if;
end;
$function$;

revoke execute on function public.get_my_instructor_listing()        from public;
revoke execute on function public.set_my_instructor_listing(boolean) from public;
revoke execute on function public.set_my_public_contact(text, text)  from public;

grant execute on function public.get_my_instructor_listing()        to authenticated;
grant execute on function public.set_my_instructor_listing(boolean) to authenticated;
grant execute on function public.set_my_public_contact(text, text)  to authenticated;
