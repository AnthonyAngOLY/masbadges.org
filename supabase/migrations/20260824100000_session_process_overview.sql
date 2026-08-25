-- 20260824100000_session_process_overview.sql
--
-- Task 3 — extend the per-session "check" system (MySessions / CheckpointBar /
-- list_session_tracker) into a FULL financial-lifecycle process overview,
-- gated to the finance-governance tier.
--
--   Row-level flags  → list_session_financial_flags()  (drives the "Reconciled"
--                       pill + payout-pending badge on every governance row)
--   Expanded detail  → get_session_process_overview(_session_id)  (the phased
--                       Setup → Money-in → Assessment → Certificates → Money-out
--                       → Reconciled panel, fetched lazily on expand)
--
-- Financial-gov tier: finance_officer, finance_approver, chairperson,
-- system_admin, chief_examiner. NOT board_member (they keep the operational
-- 6-step bar only) and NOT the plain instructor/examiner (already excluded).
--
-- DEPENDS ON Task 2: reads public.payment_vouchers (session_id, category,
-- status in draft|approved|paid|void, amount, voucher_no, payee_name). If your
-- Task 2 build renamed any of those columns, adjust the three references below.
--
-- Apply in the Supabase SQL editor (prefix `reset role;`). Safe to re-run.

-- ===========================================================================
-- (0) internal — is a session fully reconciled? No auth gate; revoked from all
--     callers except definer functions. Reused by both public RPCs below.
-- ===========================================================================
create or replace function public._session_reconciled(_session_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $fn$
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
$fn$;

revoke all on function public._session_reconciled(uuid) from public, authenticated;

-- ===========================================================================
-- (1) row-level flags for the governance session list — one row per session
--     the caller may oversee; empty for anyone outside the finance-gov tier.
-- ===========================================================================
create or replace function public.list_session_financial_flags()
returns table (
  session_id       uuid,
  reconciled       boolean,
  has_bonus        boolean,
  payouts_pending  integer
)
language sql
stable
security definer
set search_path to ''
as $fn$
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
$fn$;

grant execute on function public.list_session_financial_flags() to authenticated;

-- ===========================================================================
-- (2) the full phased overview for one session (lazy, on row expand).
--     Returns null when the caller is outside the finance-gov tier so the FE
--     simply doesn't render the panel (board_member, instructor, examiner).
-- ===========================================================================
create or replace function public.get_session_process_overview(_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $fn$
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
$fn$;

grant execute on function public.get_session_process_overview(uuid) to authenticated;
