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


-- ============================================================================
-- PART 8b — the last 3 tables. Capture complete: all 33 functions and all 10
-- tables from the Part 1 inventory are now recorded.
--
-- All three carry RLS with NO policies, so every read and write goes through
-- the security-definer RPCs; direct access is denied to anon and authenticated
-- alike. Grants are wide but inert against that.
-- ============================================================================

create table if not exists public.centre_invitations (
  id uuid default gen_random_uuid() not null,
  partner_center_id uuid not null,
  email text not null,
  status text default 'pending'::text not null,
  invited_by_profile_id uuid,
  accepted_profile_id uuid,
  created_at timestamp with time zone default now() not null,
  accepted_at timestamp with time zone
);
alter table public.centre_invitations add constraint centre_invitations_pkey primary key (id);
alter table public.centre_invitations add constraint centre_invitations_partner_center_id_fkey
  foreign key (partner_center_id) references public.partner_centers(id);
alter table public.centre_invitations add constraint centre_invitations_invited_by_profile_id_fkey
  foreign key (invited_by_profile_id) references public.profiles(id);
alter table public.centre_invitations add constraint centre_invitations_accepted_profile_id_fkey
  foreign key (accepted_profile_id) references public.profiles(id);
alter table public.centre_invitations add constraint centre_invitations_status_check
  check ((status = any (array['pending'::text, 'accepted'::text, 'revoked'::text])));
alter table public.centre_invitations enable row level security;

create table if not exists public.centre_payments (
  id uuid default gen_random_uuid() not null,
  centre_invoice_id uuid not null,
  method text not null,
  amount numeric(10,2) not null,
  reference text,
  proof_url text,
  recorded_by_profile_id uuid,
  recorded_at timestamp with time zone default now() not null
);
alter table public.centre_payments add constraint centre_payments_pkey primary key (id);
alter table public.centre_payments add constraint centre_payments_centre_invoice_id_fkey
  foreign key (centre_invoice_id) references public.centre_invoices(id);
alter table public.centre_payments add constraint centre_payments_recorded_by_profile_id_fkey
  foreign key (recorded_by_profile_id) references public.profiles(id);
alter table public.centre_payments add constraint centre_payments_method_check
  check ((method = any (array['cash'::text, 'qr'::text, 'transfer'::text])));
alter table public.centre_payments enable row level security;

create table if not exists public.store_payments (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  method text not null,
  amount numeric(10,2) not null,
  reference text,
  proof_url text,
  recorded_by_profile_id uuid,
  recorded_at timestamp with time zone default now() not null
);
alter table public.store_payments add constraint store_payments_pkey primary key (id);
alter table public.store_payments add constraint store_payments_order_id_fkey
  foreign key (order_id) references public.store_orders(id);
alter table public.store_payments add constraint store_payments_recorded_by_profile_id_fkey
  foreign key (recorded_by_profile_id) references public.profiles(id);
alter table public.store_payments add constraint store_payments_method_check
  check ((method = any (array['cash'::text, 'qr'::text, 'transfer'::text])));
alter table public.store_payments enable row level security;


-- ============================================================================
-- PART 8a — the last 11 functions, verbatim.
-- Short ones first; the two long lifecycle functions close the file.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_buy_store()
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$ select public.has_role('instructor') or public.has_role('partner_center_admin'); $function$;

CREATE OR REPLACE FUNCTION public.can_manage_store()
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$ select public.has_role('system_admin') or public.has_role('chairperson') or public.has_role('board_member'); $function$;

CREATE OR REPLACE FUNCTION public.get_centre_payments(_invoice uuid)
 RETURNS SETOF centre_payments LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$ select * from public.centre_payments where centre_invoice_id = _invoice and public.can_bill_centres() order by recorded_at; $function$;

CREATE OR REPLACE FUNCTION public.get_store_order_items(_order uuid)
 RETURNS SETOF store_order_items LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  select i.* from public.store_order_items i
  where i.order_id = _order
    and (public.can_manage_store()
         or exists (select 1 from public.store_orders o where o.id = _order and o.ordered_by_profile_id = auth.uid()));
$function$;

CREATE OR REPLACE FUNCTION public.log_account_event(_action text, _target_profile_id uuid, _detail jsonb DEFAULT '{}'::jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
  if not (public.has_role('system_admin') or public.has_role('chairperson')) then
    raise exception 'not authorized to log account events' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_log
    (actor_profile_id, action, object_type, object_id, session_id, detail)
  values
    ((select auth.uid()), _action, 'account', _target_profile_id, null, coalesce(_detail, '{}'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.grant_centre_admin_on_signup()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare _inv record;
begin
  for _inv in
    select * from public.centre_invitations
    where lower(email) = lower(NEW.email) and status = 'pending'
  loop
    begin
      insert into public.memberships(profile_id, role, partner_center_id, status)
      values (NEW.id, 'partner_center_admin', _inv.partner_center_id, 'active');
    exception when others then null;
    end;
    -- The POC becomes the centre's principal (point of communication account).
    update public.partner_centers set principal_profile_id = NEW.id
     where id = _inv.partner_center_id;
    update public.centre_invitations
       set status = 'accepted', accepted_profile_id = NEW.id, accepted_at = now()
     where id = _inv.id;
  end loop;
  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_centre_admin_overview()
 RETURNS TABLE(centre_id uuid, centre_name text, state my_state, centre_status partner_center_status, valid_until date, active_instructors integer, latest_invoice_status text, latest_invoice_total numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  select pc.id, pc.name, pc.state, pc.status, pc.valid_until,
         (select count(*)::int from public.memberships m
            where m.role = 'instructor' and m.partner_center_id = pc.id and m.status = 'active'
              and (m.expires_at is null or m.expires_at >= current_date)),
         ci.status, ci.total_amount
  from public.partner_centers pc
  left join lateral (
    select * from public.centre_invoices c where c.partner_center_id = pc.id
    order by c.issued_at desc limit 1
  ) ci on true
  where pc.principal_profile_id = auth.uid()
     or exists (select 1 from public.memberships m
                where m.profile_id = auth.uid() and m.role = 'partner_center_admin'
                  and m.partner_center_id = pc.id and m.status = 'active');
$function$;

CREATE OR REPLACE FUNCTION public.list_session_financial_flags()
 RETURNS TABLE(session_id uuid, reconciled boolean, has_bonus boolean, payouts_pending integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  select
    s.id,
    public._session_reconciled(s.id),
    exists (select 1 from public.assessment_results r
             where r.session_id = s.id and r.billing_stage = 'bonus'),
    (select count(*)::int from public.payment_vouchers pv
       where pv.session_id = s.id and pv.status in ('draft', 'approved'))
  from public.assessment_sessions s
  where public.has_role('finance_officer') or public.has_role('finance_approver')
     or public.has_role('chairperson')     or public.has_role('system_admin')
     or public.has_role('chief_examiner');
$function$;

-- ⚠ BROKEN: inserts status = 'placed', which is not in store_order_status.
-- Nothing calls it — Store.tsx uses submit_store_order() — so it is dead code
-- that would fail if ever wired up. See the store note at the end of this file.
CREATE OR REPLACE FUNCTION public.place_store_order(_items jsonb, _partner_center_id uuid DEFAULT NULL::uuid, _shipping_address text DEFAULT NULL::text, _note text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare _order uuid; _total numeric(10,2) := 0; _it jsonb; _price numeric; _label text; _qty int;
begin
  if not public.can_buy_store() then raise exception 'Only instructors and centre administrators can order.'; end if;
  if _items is null or jsonb_array_length(_items) = 0 then raise exception 'Your order is empty.'; end if;

  insert into public.store_orders(ordered_by_profile_id, partner_center_id, status, shipping_address, note)
  values (auth.uid(), _partner_center_id, 'placed',
          nullif(trim(coalesce(_shipping_address,'')),''), nullif(trim(coalesce(_note,'')),''))
  returning id into _order;

  for _it in select * from jsonb_array_elements(_items) loop
    select unit_price, name into _price, _label
    from public.store_products where id = (_it->>'product_id')::uuid and active;
    if not found then raise exception 'A selected product is not available.'; end if;
    _qty := greatest(1, coalesce((_it->>'quantity')::int, 1));
    insert into public.store_order_items(order_id, product_id, label, quantity, unit_price, line_total)
    values (_order, (_it->>'product_id')::uuid, _label, _qty, _price, _price * _qty);
    _total := _total + _price * _qty;
  end loop;

  update public.store_orders set total_amount = _total where id = _order;
  return _order;
end;
$function$;

-- The two session-lifecycle functions. _session_reconciled is the single
-- definition of "this session is finished" used by both the financial-flags
-- list and the overview below.
--
-- Note it computes money-out from payout_schedule (expected CD-4 splits over
-- booked passes), whereas the shipped /admin/session-lifecycle page reports
-- money due out as raised vouchers only. Both are deliberate and they answer
-- different questions; don't reconcile one to the other without deciding which
-- the page is meant to show.

CREATE OR REPLACE FUNCTION public._session_reconciled(_session_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  v_status          public.session_status;
  v_completed       boolean;
  v_has_bonus       boolean;
  v_booked_paid     boolean;
  v_bonus_paid      boolean;
  v_money_in_ok     boolean;
  v_has_pass        boolean;
  v_certs_ok        boolean;
  v_expected_out    numeric;
  v_out_applicable  boolean;
  v_out_paid        boolean;
  v_money_out_ok    boolean;
begin
  select status into v_status
    from public.assessment_sessions where id = _session_id;
  if not found then
    return false;
  end if;
  v_completed := v_status in ('completed', 'closed', 'archived');

  -- money in — booked prepay must be paid
  v_booked_paid := exists (
    select 1 from public.invoices i
     where i.session_id = _session_id and i.stage = 'booked_prepay'
       and i.status = 'paid');

  -- bonus sub-cycle only applies when there are bonus-stage passes
  v_has_bonus := exists (
    select 1 from public.assessment_results r
     where r.session_id = _session_id and r.billing_stage = 'bonus');
  v_bonus_paid := (not v_has_bonus) or exists (
    select 1 from public.invoices i
     where i.session_id = _session_id and i.stage = 'bonus_reconcile'
       and i.status = 'paid');

  v_money_in_ok := v_booked_paid and v_bonus_paid;

  -- certificates — at least one pass, and every pass row has a certificate
  v_has_pass := exists (
    select 1 from public.assessment_results r
     where r.session_id = _session_id and r.outcome = 'pass');
  v_certs_ok := v_has_pass and not exists (
    select 1 from public.assessment_results r
     where r.session_id = _session_id and r.outcome = 'pass'
       and r.certificate_id is null);

  -- money out — expected disbursements from CD-4 payout_schedule (booked passes)
  select coalesce(sum(ps.examiner_rm + ps.instructor_rm + ps.hosting_rm), 0)
    into v_expected_out
    from public.assessment_results r
    join public.payout_schedule ps
      on ps.level_band = public.badge_level_to_band(r.target_level)
   where r.session_id = _session_id and r.outcome = 'pass'
     and r.billing_stage = 'booked';
  v_out_applicable := v_expected_out > 0;

  -- disbursed = at least one live voucher AND none still draft/approved
  v_out_paid := exists (
      select 1 from public.payment_vouchers pv
       where pv.session_id = _session_id and pv.status <> 'void')
    and not exists (
      select 1 from public.payment_vouchers pv
       where pv.session_id = _session_id and pv.status in ('draft', 'approved'));
  v_money_out_ok := (not v_out_applicable) or v_out_paid;

  return v_completed and v_money_in_ok and v_certs_ok and v_money_out_ok;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_session_process_overview(_session_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  v_ok              boolean;
  v_status          public.session_status;
  v_examiner        uuid;
  v_candidate_count int;
  v_has_bonus       boolean;

  v_booked_no       text;  v_booked_status text;  v_booked_total numeric;  v_booked_paid_at timestamptz;
  v_booked_rcpt     text;  v_booked_rcpt_amt numeric;
  v_bonus_no        text;  v_bonus_status  text;  v_bonus_total  numeric;  v_bonus_paid_at  timestamptz;
  v_bonus_rcpt      text;  v_bonus_rcpt_amt  numeric;

  v_pass int; v_refer int;
  v_bk_cert_total int; v_bk_cert_issued int;
  v_bn_cert_total int; v_bn_cert_issued int;

  v_exp_examiner numeric; v_exp_instructor numeric; v_exp_hosting numeric;
  v_vouchers jsonb;
  v_out_applicable boolean; v_out_raised boolean; v_out_approved boolean; v_out_paid boolean;
begin
  v_ok := public.has_role('finance_officer') or public.has_role('finance_approver')
       or public.has_role('chairperson')     or public.has_role('system_admin')
       or public.has_role('chief_examiner');
  if not v_ok then
    return null;
  end if;

  select status, examiner_profile_id
    into v_status, v_examiner
    from public.assessment_sessions where id = _session_id;
  if not found then
    return null;
  end if;

  select count(*)::int into v_candidate_count
    from public.session_enrolments where session_id = _session_id;

  -- money in — booked
  select i.receipt_no, i.status, i.total, i.paid_at
    into v_booked_no, v_booked_status, v_booked_total, v_booked_paid_at
    from public.invoices i
   where i.session_id = _session_id and i.stage = 'booked_prepay' and i.status <> 'void'
   order by i.created_at desc limit 1;
  select r.receipt_no, r.amount
    into v_booked_rcpt, v_booked_rcpt_amt
    from public.receipts r
    join public.invoices i on i.id = r.invoice_id
   where i.session_id = _session_id and i.stage = 'booked_prepay'
   order by r.created_at desc limit 1;

  -- money in — bonus
  v_has_bonus := exists (select 1 from public.assessment_results r
                          where r.session_id = _session_id and r.billing_stage = 'bonus');
  select i.receipt_no, i.status, i.total, i.paid_at
    into v_bonus_no, v_bonus_status, v_bonus_total, v_bonus_paid_at
    from public.invoices i
   where i.session_id = _session_id and i.stage = 'bonus_reconcile' and i.status <> 'void'
   order by i.created_at desc limit 1;
  select r.receipt_no, r.amount
    into v_bonus_rcpt, v_bonus_rcpt_amt
    from public.receipts r
    join public.invoices i on i.id = r.invoice_id
   where i.session_id = _session_id and i.stage = 'bonus_reconcile'
   order by r.created_at desc limit 1;

  -- results / certificates
  select
    count(*) filter (where outcome = 'pass')::int,
    count(*) filter (where outcome <> 'pass')::int,
    count(*) filter (where outcome = 'pass' and billing_stage = 'booked')::int,
    count(*) filter (where outcome = 'pass' and billing_stage = 'booked' and certificate_id is not null)::int,
    count(*) filter (where outcome = 'pass' and billing_stage = 'bonus')::int,
    count(*) filter (where outcome = 'pass' and billing_stage = 'bonus' and certificate_id is not null)::int
    into v_pass, v_refer, v_bk_cert_total, v_bk_cert_issued, v_bn_cert_total, v_bn_cert_issued
    from public.assessment_results
   where session_id = _session_id;

  -- money out — expected CD-4 splits over booked passes
  select
    coalesce(sum(ps.examiner_rm), 0),
    coalesce(sum(ps.instructor_rm), 0),
    coalesce(sum(ps.hosting_rm), 0)
    into v_exp_examiner, v_exp_instructor, v_exp_hosting
    from public.assessment_results r
    join public.payout_schedule ps
      on ps.level_band = public.badge_level_to_band(r.target_level)
   where r.session_id = _session_id and r.outcome = 'pass' and r.billing_stage = 'booked';

  select coalesce(jsonb_agg(jsonb_build_object(
             'voucher_no', pv.voucher_no,
             'category',   pv.category,
             'status',     pv.status,
             'amount',     pv.amount,
             'payee_name', pv.payee_name
           ) order by pv.created_at), '[]'::jsonb)
    into v_vouchers
    from public.payment_vouchers pv
   where pv.session_id = _session_id and pv.status <> 'void';

  v_out_applicable := (v_exp_examiner + v_exp_instructor + v_exp_hosting) > 0;
  v_out_raised   := jsonb_array_length(v_vouchers) > 0;
  v_out_approved := v_out_raised and not exists (
      select 1 from public.payment_vouchers pv
       where pv.session_id = _session_id and pv.status = 'draft');
  v_out_paid := v_out_raised and not exists (
      select 1 from public.payment_vouchers pv
       where pv.session_id = _session_id and pv.status in ('draft', 'approved'));

  return jsonb_build_object(
    'session_id', _session_id,
    'session_status', v_status,
    'reconciled', public._session_reconciled(_session_id),
    'setup', jsonb_build_object(
      'created', true,
      'roster', v_candidate_count > 0,
      'candidate_count', v_candidate_count,
      'examiner', v_examiner is not null
    ),
    'money_in_booked', jsonb_build_object(
      'applicable', v_booked_no is not null,
      'invoice_no', v_booked_no,
      'issued', v_booked_status in ('issued', 'paid'),
      'paid', v_booked_status = 'paid',
      'total', v_booked_total,
      'paid_at', v_booked_paid_at,
      'receipt_no', v_booked_rcpt,
      'receipt_amount', v_booked_rcpt_amt
    ),
    'assessment', jsonb_build_object(
      'completed', v_status in ('completed', 'closed', 'archived'),
      'graded', (v_pass + v_refer) > 0,
      'pass_count', v_pass,
      'refer_count', v_refer
    ),
    'money_in_bonus', jsonb_build_object(
      'applicable', v_has_bonus,
      'invoice_no', v_bonus_no,
      'issued', v_bonus_status in ('issued', 'paid'),
      'paid', v_bonus_status = 'paid',
      'total', v_bonus_total,
      'paid_at', v_bonus_paid_at,
      'receipt_no', v_bonus_rcpt,
      'receipt_amount', v_bonus_rcpt_amt
    ),
    'certificates', jsonb_build_object(
      'booked_total', v_bk_cert_total,
      'booked_issued', v_bk_cert_issued,
      'bonus_total', v_bn_cert_total,
      'bonus_issued', v_bn_cert_issued,
      'all_issued', v_pass > 0
        and v_bk_cert_total = v_bk_cert_issued
        and v_bn_cert_total = v_bn_cert_issued
    ),
    'money_out', jsonb_build_object(
      'applicable', v_out_applicable,
      'expected_examiner', v_exp_examiner,
      'expected_instructor', v_exp_instructor,
      'expected_hosting', v_exp_hosting,
      'raised', v_out_raised,
      'approved', v_out_approved,
      'paid', v_out_paid,
      'vouchers', v_vouchers
    )
  );
end;
$function$;


-- ============================================================================
-- CAPTURE COMPLETE. All 33 functions and 10 tables from the Part 1 inventory
-- are now in git, across this file and captured_live_schema_2026-11-10.sql.
--
-- GRANTS: every function above is granted to anon, authenticated, public and
-- service_role, except _session_reconciled which is anon + service_role only.
-- Each gates in its own body, so this is belt-and-braces rather than a hole —
-- but see the standing note in CLAUDE.md: do not rely on the grant list.
--
-- ⚠ THE STORE ADMIN ORDER FLOW IS BROKEN. Two generations of store RPCs exist
-- and StoreAdmin.tsx calls the dead one.
--
--   Working generation, in git (20260710203000_store_rpcs.sql), matching the
--   enum exactly:  submit_store_order → fo_invoice_store_order →
--   fo_mark_store_order_paid → fo_ship_store_order, plus cancel_store_order.
--   Lifecycle: submitted → invoiced → paid → shipped (or cancelled).
--
--   Dead generation, SQL-editor only, never in git, using values that are NOT
--   in store_order_status:  place_store_order ('placed'),
--   mark_store_order_paid ('placed'), fulfil_store_order ('fulfilled').
--
-- What this means on /admin/store today:
--   · list_store_orders is called with _status = the tab name. Two of the three
--     tabs pass 'placed' and 'fulfilled', so those tabs error on load. Only
--     "Paid · to ship" lists anything.
--   · "Mark paid" calls mark_store_order_paid → enum error, every time.
--   · "Mark shipped" calls fulfil_store_order → enum error, every time.
--   · There is no Invoice action at all, so an order cannot reach 'invoiced',
--     which is the state fo_mark_store_order_paid requires.
--
-- The buyer side is fine: Store.tsx calls submit_store_order, which is correct.
--
-- NOT FIXED HERE. The repair is a frontend change — repoint StoreAdmin.tsx to
-- the fo_* functions, correct the tab vocabulary to the real enum, and add the
-- missing Invoice step — plus a decision on whether to drop the three dead
-- functions. That is product work, not transcription.
-- ============================================================================
