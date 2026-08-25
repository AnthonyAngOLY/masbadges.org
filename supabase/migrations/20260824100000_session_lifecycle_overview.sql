-- Session lifecycle overview — the end-to-end process checker for one assessment
-- session, from candidate roster through certification and out the money-OUT side.
--
-- The existing list_session_tracker() (#15) stops at "Payment cleared" and
-- "Certificates issued": it answers the operator's question ("is my session on
-- track?"). This answers the controller's question: "has every obligation on
-- this session been discharged, and if not, where is it stuck?"
--
-- Eleven checkpoints, in the order they actually occur:
--   1  created           the session exists
--   2  roster            candidates enrolled
--   3  invoice_issued    invoice numbered and issued (money IN raised)
--   4  payment_collected invoice fully paid
--   5  receipt_issued    receipt minted for that payment
--   6  examiner          examiner assigned or picked up
--   7  completed         session completed / closed / archived
--   8  certificates      every passing candidate has a certificate
--   9  payout_raised     at least one live payment voucher exists (money OUT)
--   10 payout_approved   no voucher still sitting in draft
--   11 payout_paid       every live voucher paid
--
-- Read-only: no schema change, no writes, nothing that alters the money path.
-- Gated to the roles that already see every session in list_session_tracker()
-- (finance_officer, chairperson, system_admin, board_member, chief_examiner) —
-- narrowing that here would be a step backwards from what they see today.
--
-- Voided vouchers are excluded from 9/10/11 throughout. A voided voucher is a
-- withdrawn proposal, not an outstanding obligation; counting it would leave a
-- session permanently "stuck" on a decision that was already made.

-- ============ 1 · role gate helper ============
create or replace function public.can_view_session_lifecycle()
 returns boolean
 language sql stable
 set search_path to ''
as $fn$
  select public.has_role('finance_officer')
      or public.has_role('chairperson')
      or public.has_role('system_admin')
      or public.has_role('board_member')
      or public.has_role('chief_examiner');
$fn$;
grant execute on function public.can_view_session_lifecycle() to authenticated;

-- ============ 2 · the register ============
create or replace function public.list_session_lifecycle()
 returns table(
   session_id        uuid,
   venue             text,
   state             public.my_state,
   scheduled_on      date,
   status            public.session_status,
   centre_name       text,
   booker_name       text,
   examiner_name     text,
   candidate_count   integer,

   -- the eleven checkpoints
   cp_created           boolean,
   cp_roster            boolean,
   cp_invoice_issued    boolean,
   cp_payment_collected boolean,
   cp_receipt_issued    boolean,
   cp_examiner          boolean,
   cp_completed         boolean,
   cp_certificates      boolean,
   cp_payout_raised     boolean,
   cp_payout_approved   boolean,
   cp_payout_paid       boolean,

   -- the first unmet checkpoint, or null when the session is fully discharged
   stuck_at          text,
   steps_done        integer,

   -- money in
   invoice_no        text,
   invoice_status    text,
   invoice_total     numeric,
   paid_to_date      numeric,
   receipt_no        text,

   -- money out
   voucher_count     integer,
   voucher_total     numeric,
   voucher_paid      numeric
 )
 language sql
 stable security definer
 set search_path to ''
as $fn$
  with sess as (
    select
      s.id, s.venue, s.state, s.scheduled_on, s.status,
      s.examiner_profile_id, s.requested_by_profile_id, s.partner_center_id,
      s.created_at
    from public.assessment_sessions s
    where public.can_view_session_lifecycle()
  ),
  inv as (
    select distinct on (i.session_id)
      i.session_id, i.id as invoice_id, i.receipt_no, i.status, i.total
    from public.invoices i
    where i.stage = 'booked_prepay'
    order by i.session_id, i.created_at desc
  ),
  paid as (
    select p.invoice_id, sum(p.amount) as amount
    from public.payments p
    where p.direction = 'inbound'
    group by p.invoice_id
  ),
  vou as (
    select
      pv.session_id,
      count(*)::int                                            as n,
      sum(pv.amount)                                           as total,
      sum(pv.amount) filter (where pv.status = 'paid')         as paid,
      count(*) filter (where pv.status = 'draft')              as drafts,
      count(*) filter (where pv.status <> 'paid')              as unpaid
    from public.payment_vouchers pv
    where pv.session_id is not null and pv.status <> 'void'
    group by pv.session_id
  ),
  flags as (
    select
      s.*,
      pc.name as centre_name,
      coalesce(bk.full_name, bk.email) as booker_name,
      coalesce(ex.full_name, ex.email) as examiner_name,
      (select count(*)::int from public.session_enrolments e where e.session_id = s.id) as candidate_count,
      inv.receipt_no as invoice_no,
      inv.status     as invoice_status,
      inv.total      as invoice_total,
      coalesce(paid.amount, 0) as paid_to_date,
      rc.receipt_no  as receipt_no,
      coalesce(vou.n, 0)     as voucher_count,
      coalesce(vou.total, 0) as voucher_total,
      coalesce(vou.paid, 0)  as voucher_paid,

      true as cp_created,
      exists (select 1 from public.session_enrolments e where e.session_id = s.id) as cp_roster,
      (inv.receipt_no is not null and inv.status in ('issued', 'paid')) as cp_invoice_issued,
      (inv.status = 'paid') as cp_payment_collected,
      (rc.receipt_no is not null) as cp_receipt_issued,
      (s.examiner_profile_id is not null) as cp_examiner,
      (s.status in ('completed', 'closed', 'archived')) as cp_completed,
      (    exists (select 1 from public.assessment_results r
                    where r.session_id = s.id and r.outcome = 'pass')
       and not exists (select 1 from public.assessment_results r
                    where r.session_id = s.id and r.outcome = 'pass'
                      and r.certificate_id is null)) as cp_certificates,
      (coalesce(vou.n, 0) > 0) as cp_payout_raised,
      (coalesce(vou.n, 0) > 0 and coalesce(vou.drafts, 0) = 0) as cp_payout_approved,
      (coalesce(vou.n, 0) > 0 and coalesce(vou.unpaid, 0) = 0) as cp_payout_paid
    from sess s
    left join inv on inv.session_id = s.id
    left join paid on paid.invoice_id = inv.invoice_id
    left join lateral (
      select r.receipt_no from public.receipts r
      where r.invoice_id = inv.invoice_id
      order by r.created_at desc limit 1
    ) rc on true
    left join vou on vou.session_id = s.id
    left join public.partner_centers pc on pc.id = s.partner_center_id
    left join public.profiles bk on bk.id = s.requested_by_profile_id
    left join public.profiles ex on ex.id = s.examiner_profile_id
  )
  select
    f.id, f.venue, f.state, f.scheduled_on, f.status,
    f.centre_name, f.booker_name, f.examiner_name, f.candidate_count,
    f.cp_created, f.cp_roster, f.cp_invoice_issued, f.cp_payment_collected,
    f.cp_receipt_issued, f.cp_examiner, f.cp_completed, f.cp_certificates,
    f.cp_payout_raised, f.cp_payout_approved, f.cp_payout_paid,
    -- first unmet checkpoint; null once everything is discharged
    case
      when not f.cp_roster            then 'Roster confirmed'
      when not f.cp_invoice_issued    then 'Invoice issued'
      when not f.cp_payment_collected then 'Payment collected'
      when not f.cp_receipt_issued    then 'Receipt issued'
      when not f.cp_examiner          then 'Examiner assigned'
      when not f.cp_completed         then 'Session completed'
      when not f.cp_certificates      then 'Certificates issued'
      when not f.cp_payout_raised     then 'Payout vouchers raised'
      when not f.cp_payout_approved   then 'Payout vouchers approved'
      when not f.cp_payout_paid       then 'Payout vouchers paid'
      else null
    end as stuck_at,
    (f.cp_created::int + f.cp_roster::int + f.cp_invoice_issued::int
     + f.cp_payment_collected::int + f.cp_receipt_issued::int + f.cp_examiner::int
     + f.cp_completed::int + f.cp_certificates::int + f.cp_payout_raised::int
     + f.cp_payout_approved::int + f.cp_payout_paid::int) as steps_done,
    f.invoice_no, f.invoice_status, f.invoice_total, f.paid_to_date, f.receipt_no,
    f.voucher_count, f.voucher_total, f.voucher_paid
  from flags f
  order by f.scheduled_on nulls last, f.created_at desc;
$fn$;

grant execute on function public.list_session_lifecycle() to authenticated;

-- ============ 3 · the drill-down ============
-- One session's full paper trail: the invoice and its receipts on the money-IN
-- side, every voucher on the money-OUT side, and the audit events already
-- recorded against the session. Definer, because board_member and
-- chief_examiner can read this overview but cannot select payment_vouchers
-- directly under its RLS — the aggregate view is theirs, the register is not.
create or replace function public.get_session_lifecycle_detail(_session_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $fn$
declare
  v jsonb;
begin
  if not public.can_view_session_lifecycle() then
    raise exception 'not authorized to view session lifecycle' using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'session_id', s.id,
    'venue', s.venue,
    'scheduled_on', s.scheduled_on,
    'status', s.status,

    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'invoice_id', i.id,
               'invoice_no', i.receipt_no,
               'stage', i.stage,
               'status', i.status,
               'total', i.total,
               'paid_to_date', coalesce((
                 select sum(p.amount) from public.payments p
                 where p.invoice_id = i.id and p.direction = 'inbound'), 0),
               'issued_at', i.issued_at,
               'paid_at', i.paid_at,
               'receipts', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'receipt_no', r.receipt_no,
                          'amount', r.amount,
                          'method', r.method,
                          'reference', r.reference,
                          'created_at', r.created_at) order by r.created_at)
                 from public.receipts r where r.invoice_id = i.id), '[]'::jsonb))
             order by i.created_at)
      from public.invoices i where i.session_id = s.id), '[]'::jsonb),

    'vouchers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'voucher_id', pv.id,
               'voucher_no', pv.voucher_no,
               'category', pv.category,
               'status', pv.status,
               'amount', pv.amount,
               'payee_name', coalesce(pp.full_name, pp.email, pv.payee_name),
               'prepared_by', coalesce(prep.full_name, prep.email),
               'prepared_at', pv.prepared_at,
               'approved_by', coalesce(appr.full_name, appr.email),
               'approved_at', pv.approved_at,
               'paid_at', pv.paid_at,
               'void_reason', pv.void_reason)
             order by pv.prepared_at)
      from public.payment_vouchers pv
      left join public.profiles pp   on pp.id = pv.payee_profile_id
      left join public.profiles prep on prep.id = pv.prepared_by
      left join public.profiles appr on appr.id = pv.approved_by
      where pv.session_id = s.id), '[]'::jsonb),

    'audit', coalesce((
      select jsonb_agg(jsonb_build_object(
               'action', a.action,
               'detail', a.detail,
               'created_at', a.created_at,
               'actor', coalesce(ap.full_name, ap.email))
             order by a.created_at desc)
      from public.audit_log a
      left join public.profiles ap on ap.id = a.actor_profile_id
      where a.session_id = s.id), '[]'::jsonb)
  ) into v
  from public.assessment_sessions s
  where s.id = _session_id;

  if v is null then
    raise exception 'session not found';
  end if;

  return v;
end;
$fn$;

grant execute on function public.get_session_lifecycle_detail(uuid) to authenticated;
