-- ============================================================================
-- captured_live_schema_part8.sql
--
-- Continues captured_live_schema_2026-11-10.sql. PART 8c output, captured
-- 2026-11-10. 8a (the 11 remaining functions) and 8b (centre_payments,
-- centre_invitations, store_payments) are still outstanding.
--
-- NOT YET RUNNABLE as a migration — see the parent capture file.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ENUM TYPES — the full set, as deployed
-- Most already have creating migrations; store_order_status did not, and
-- public.store_orders depends on it.
-- ----------------------------------------------------------------------------

create type public.assessment_outcome as enum ('pass', 'refer');
create type public.badge_level as enum ('starfish', 'sea_turtle', 'guppy', 'octopus', 'frog', 'swordfish', 'dolphin');
create type public.candidate_status as enum ('active', 'withdrawn', 'anonymized');
create type public.enquiry_category as enum ('centre_partnership', 'instructor_registration', 'parent_swimmer', 'general');
create type public.enquiry_status as enum ('new', 'acknowledged', 'closed', 'archived');
create type public.enrolment_attendance as enum ('registered', 'present', 'absent', 'no_show', 'withdrawn');
create type public.membership_role as enum ('board_member', 'coaching_panel', 'chairperson', 'chief_examiner', 'examiner_trainer', 'examiner', 'instructor', 'partner_center_admin', 'system_admin', 'instructor_trainer', 'master_trainer', 'finance_officer', 'finance_approver');
create type public.membership_status as enum ('pending', 'active', 'suspended', 'expired', 'revoked');
create type public.my_state as enum ('Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak', 'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu', 'Kuala Lumpur', 'Labuan', 'Putrajaya');
create type public.partner_application_status as enum ('submitted', 'pending', 'approved', 'denied', 'archived');
create type public.partner_center_status as enum ('pending', 'recognized', 'suspended', 'removed');
create type public.result_billing_stage as enum ('booked', 'bonus');
create type public.role_kind as enum ('instructor', 'examiner');
create type public.session_status as enum ('requested', 'scheduled', 'completed', 'cancelled', 'examiner_invited', 'closed', 'archived', 'awaiting_payment', 'open_for_pickup', 'claimed', 'weather_hold');

-- ⚠ THE ONE THAT MATTERS. Note what is NOT in it: no 'fulfilled', no 'placed'.
create type public.store_order_status as enum ('submitted', 'invoiced', 'paid', 'shipped', 'cancelled');


-- ============================================================================
-- ⚠ BUG FOUND BY THIS CAPTURE — two store functions cannot run
--
-- The enum above has five values. Two deployed functions assign or compare
-- values that are not among them, so every call raises:
--
--   fulfil_store_order()     set status = 'fulfilled'
--     → ERROR: invalid input value for enum public.store_order_status: "fulfilled"
--
--   mark_store_order_paid()  where ... and status = 'placed'
--     → ERROR: invalid input value for enum public.store_order_status: "placed"
--
-- Reproduced against PostgreSQL 16 with the enum and both function bodies
-- exactly as captured. Both are called from StoreAdmin.tsx, so marking a store
-- order paid and fulfilling it are both broken on /admin/store.
--
-- Note the live database also carries fo_mark_store_order_paid() and
-- fo_ship_store_order(), which look like a later, working rewrite of the same
-- two steps — 'shipped' IS a valid value. Capture those (they are in PART 8a's
-- sibling set) before deciding whether to repair these two or retire them in
-- favour of the fo_* pair and repoint StoreAdmin.tsx.
--
-- NOT FIXED HERE. Fixing it means choosing between the two implementations,
-- which is a product decision, not a transcription.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- VIEWS — all four, as deployed
-- ----------------------------------------------------------------------------

-- Matches 20261010100000_instructor_directory_opt_in.sql exactly, which
-- confirms that migration applied cleanly: the consent gate
-- (public_listing IS TRUE), the independent flag and both public contact
-- columns are all present.
create or replace view public.instructor_directory as
  select m.profile_id,
         p.full_name,
         m.state,
         m.partner_center_id,
         pc.name as centre_name,
         m.partner_center_id is null as independent,
         m.public_contact_email,
         m.public_contact_phone
    from memberships m
    join profiles p on p.id = m.profile_id
    left join partner_centers pc on pc.id = m.partner_center_id
   where m.role = 'instructor'::membership_role
     and m.status = 'active'::membership_status
     and m.public_listing is true
     and (m.expires_at is null or m.expires_at >= current_date)
     and not (exists (select 1 from instructor_blacklist b
                       where b.profile_id = p.id and b.lifted_at is null));

create or replace view public.partner_center_directory as
  select id, name, state, contact_email, contact_phone, address, recognized_at
    from partner_centers pc
   where status = 'recognized'::partner_center_status;

create or replace view public.public_content_overrides as
  select key, value from content_overrides;

create or replace view public.public_courses as
  select id, kind, title, description, state, venue, starts_on, ends_on,
         capacity, fee, registration_url
    from courses
   where is_published = true;
