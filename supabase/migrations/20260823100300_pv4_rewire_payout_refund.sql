-- Payment Vouchers · step 4 of 5 — route the two existing money-OUT paths
-- (CD-4 session payouts, cancellation refunds) through the voucher module.
--
-- Before: Accounts.tsx called record_examiner_payout() and BillingPayments.tsx
--         called mark_refund_paid(). Both wrote payments(direction='payout')
--         directly, with no authorisation step and no document.
-- After:  both raise a DRAFT voucher pre-filled from the data we already hold;
--         approval allocates the PV number; paying writes the same ledger row.
--
-- Prereq: step 3 applied and committed.

-- ============ 1 · session payout vouchers (CD-4) ============
-- Who is paid which component, per Manual Appendix D CD-4:
--   examiner   → the assigned examiner
--   instructor → the booking instructor
--   hosting    → the partner centre when the session runs at one (external
--                payee: a centre is not a portal profile), otherwise the
--                booking instructor who arranged the venue. MAS-hosted
--                sessions have no external hosting payee — nothing to raise.
--   mas_retention is not a disbursement; it never becomes a voucher.
create or replace function public.get_session_payout_targets(_session_id uuid)
 returns table(
   component        text,
   category         text,
   amount           numeric,
   payee_profile_id uuid,
   payee_name       text,
   payable          boolean
 )
 language plpgsql
 stable security definer
 set search_path to ''
as $fn$
declare
  b record;
  v_examiner   uuid;
  v_instructor uuid;
  v_centre     uuid;
  v_centre_nm  text;
  v_ex_name    text;
  v_in_name    text;
begin
  if not (public.has_role('system_admin') or public.has_role('chairperson')
       or public.has_role('board_member') or public.has_role('chief_examiner')
       or public.has_role('finance_officer') or public.has_role('finance_approver')) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  select s.examiner_profile_id, s.requested_by_profile_id, s.partner_center_id,
         pc.name,
         coalesce(ep.full_name, ep.email), coalesce(ip.full_name, ip.email)
    into v_examiner, v_instructor, v_centre, v_centre_nm, v_ex_name, v_in_name
    from public.assessment_sessions s
    left join public.partner_centers pc on pc.id = s.partner_center_id
    left join public.profiles ep on ep.id = s.examiner_profile_id
    left join public.profiles ip on ip.id = s.requested_by_profile_id
   where s.id = _session_id;

  if not found then
    raise exception 'session not found';
  end if;

  select coalesce(sum(ps.examiner_rm), 0)   as examiner_rm,
         coalesce(sum(ps.instructor_rm), 0) as instructor_rm,
         coalesce(sum(ps.hosting_rm), 0)    as hosting_rm
    into b
    from public.assessment_results ar
    join public.payout_schedule ps
      on ps.level_band = public.badge_level_to_band(ar.target_level)
   where ar.session_id = _session_id
     and ar.billing_stage = 'booked';

  return query
  select 'examiner'::text, 'examiner_payout'::text, b.examiner_rm,
         v_examiner, v_ex_name,
         (v_examiner is not null and b.examiner_rm > 0)
  union all
  select 'instructor'::text, 'instructor_payout'::text, b.instructor_rm,
         v_instructor, v_in_name,
         (v_instructor is not null and b.instructor_rm > 0)
  union all
  select 'hosting'::text, 'hosting_payout'::text, b.hosting_rm,
         case when v_centre is null then v_instructor else null end,
         case when v_centre is null then v_in_name else v_centre_nm end,
         (b.hosting_rm > 0 and (v_centre is not null or v_instructor is not null));
end;
$fn$;

grant execute on function public.get_session_payout_targets(uuid) to authenticated;

-- Raise one component's voucher, pre-filled. Amount may be overridden (a
-- part-payment or an agreed adjustment) but defaults to the CD-4 figure.
create or replace function public.prepare_session_payout_voucher(
  _session_id uuid, _component text, _amount numeric default null, _memo text default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $fn$
declare
  t record;
  v_memo text;
begin
  if not public.can_prepare_vouchers() then
    raise exception 'not authorized to prepare payment vouchers' using errcode = 'insufficient_privilege';
  end if;
  if _component not in ('examiner', 'instructor', 'hosting') then
    raise exception 'unknown payout component %', _component using errcode = 'check_violation';
  end if;

  select * into t from public.get_session_payout_targets(_session_id) g
   where g.component = _component;

  if t.category is null then
    raise exception 'session not found';
  end if;
  if not t.payable and _amount is null then
    raise exception 'no % payout is payable on this session', _component using errcode = 'check_violation';
  end if;

  v_memo := coalesce(nullif(btrim(coalesce(_memo, '')), ''),
                     'CD-4 ' || _component || ' payout, session ' || _session_id::text);

  return public.prepare_payment_voucher(
    t.category, coalesce(_amount, t.amount),
    t.payee_profile_id, t.payee_name, _session_id, null, v_memo, 'MYR');
end;
$fn$;

grant execute on function public.prepare_session_payout_voucher(uuid, text, numeric, text) to authenticated;

-- ============ 2 · payout_recorded no longer counts refunds ============
-- A refund is money out against a cancelled session; it never meant the
-- examiner had been paid. Same return shape, so create-or-replace is enough.
create or replace function public.list_sessions_overview()
 returns table (
   session_id uuid, status public.session_status, venue text, scheduled_on date,
   state public.my_state, instructor_name text, centre_name text, examiner_name text,
   candidate_count bigint, invited_count bigint, invoice_status text,
   invoice_paid boolean, payout_recorded boolean,
   instructor_remarks text, examiner_remarks text
 )
 language sql
 stable security definer
 set search_path to ''
as $function$
  select
    s.id, s.status, s.venue, s.scheduled_on, s.state,
    coalesce(ip.full_name, ip.email),
    pc.name,
    coalesce(ep.full_name, ep.email),
    (select count(*) from public.assessment_results r where r.session_id = s.id),
    (select count(*) from public.session_invitations i
       where i.session_id = s.id and i.status = 'invited'),
    inv.status,
    coalesce(inv.status = 'paid', false),
    exists (select 1 from public.payments p
              where p.session_id = s.id
                and p.direction = 'payout'
                and coalesce(p.note, '') <> 'refund'),
    case
      when s.requested_by_profile_id = auth.uid()
        or s.examiner_profile_id     = auth.uid()
        or public.has_role('chairperson')
        or public.has_role('board_member')
        or public.has_role('chief_examiner')
        or public.has_role('finance_officer')
        or public.has_role('system_admin')
      then s.instructor_remarks
      else null
    end as instructor_remarks,
    case
      when s.requested_by_profile_id = auth.uid()
        or s.examiner_profile_id     = auth.uid()
        or public.has_role('chairperson')
        or public.has_role('board_member')
        or public.has_role('chief_examiner')
        or public.has_role('finance_officer')
        or public.has_role('system_admin')
      then s.examiner_remarks
      else null
    end as examiner_remarks
  from public.assessment_sessions s
  left join public.profiles        ip on ip.id = s.requested_by_profile_id
  left join public.partner_centers pc on pc.id = s.partner_center_id
  left join public.profiles        ep on ep.id = s.examiner_profile_id
  left join lateral (
    select i.status
    from public.invoices i
    where i.session_id = s.id and i.stage = 'booked_prepay'
    order by i.created_at desc
    limit 1
  ) inv on true
  where public.has_role('chairperson')
     or public.has_role('board_member')
     or public.has_role('chief_examiner')
     or public.has_role('finance_officer')
     or public.has_role('system_admin')
  order by s.created_at desc;
$function$;

-- ============ 3 · refunds ============
-- The refund obligation list now also nets off refund vouchers already raised
-- (draft or approved) so the same refund is never prepared twice.
create or replace function public.list_refunds_due()
 returns table(
   invoice_id   uuid,
   receipt_no   text,
   session_id   uuid,
   venue        text,
   scheduled_on date,
   bill_to_id   uuid,
   bill_to_name text,
   paid_amount  numeric,
   refunded     numeric,
   refund_due   numeric
 )
 language sql
 stable security definer
 set search_path to ''
as $fn$
  with settled as (
    select i.id as invoice_id,
           coalesce((select sum(p.amount) from public.payments p
                      where p.invoice_id = i.id and p.direction = 'inbound'), 0) as paid_amount,
           coalesce((select sum(p.amount) from public.payments p
                      where p.invoice_id = i.id and p.direction = 'payout'
                        and p.note = 'refund'), 0) as refunded,
           coalesce((select sum(pv.amount) from public.payment_vouchers pv
                      where pv.invoice_id = i.id and pv.category = 'refund'
                        and pv.status in ('draft', 'approved')), 0) as committed
      from public.invoices i
  )
  select
    i.id, i.receipt_no, i.session_id, s.venue, s.scheduled_on,
    i.bill_to_profile_id,
    coalesce(nullif(trim(pr.full_name), ''), pr.email),
    x.paid_amount, x.refunded,
    x.paid_amount - x.refunded - x.committed
  from public.invoices i
  join public.assessment_sessions s on s.id = i.session_id
  join settled x on x.invoice_id = i.id
  left join public.profiles pr on pr.id = i.bill_to_profile_id
  where (public.has_role('finance_officer') or public.has_role('finance_approver')
         or public.has_role('system_admin') or public.has_role('chairperson'))
    and s.status = 'cancelled'
    and i.status = 'paid'
    and x.paid_amount - x.refunded - x.committed > 0
  order by s.scheduled_on nulls last;
$fn$;

grant execute on function public.list_refunds_due() to authenticated;

-- Raise a refund voucher pre-filled from the invoice. Defaults to the whole
-- outstanding refund obligation.
create or replace function public.prepare_refund_voucher(
  _invoice_id uuid, _amount numeric default null, _memo text default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $fn$
declare
  r record;
  v_memo text;
begin
  if not public.can_prepare_vouchers() then
    raise exception 'not authorized to prepare payment vouchers' using errcode = 'insufficient_privilege';
  end if;

  select * into r from public.list_refunds_due() d where d.invoice_id = _invoice_id;

  if r.invoice_id is null then
    raise exception 'no refund is outstanding on this invoice' using errcode = 'check_violation';
  end if;
  if _amount is not null and _amount > r.refund_due then
    raise exception 'refund of % exceeds the % still due on this invoice', _amount, r.refund_due
      using errcode = 'check_violation';
  end if;

  v_memo := coalesce(nullif(btrim(coalesce(_memo, '')), ''),
                     'Refund on cancelled session — invoice ' || coalesce(r.receipt_no, _invoice_id::text));

  return public.prepare_payment_voucher(
    'refund', coalesce(_amount, r.refund_due),
    r.bill_to_id, r.bill_to_name, r.session_id, _invoice_id, v_memo, 'MYR');
end;
$fn$;

grant execute on function public.prepare_refund_voucher(uuid, numeric, text) to authenticated;

-- ============ 4 · retire the direct refund write ============
-- Kept as a stub rather than dropped so any stale client gets a clear message
-- instead of a "function does not exist" 404.
create or replace function public.mark_refund_paid(
  _invoice_id uuid, _amount numeric, _method text default null, _reference text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $fn$
begin
  raise exception 'mark_refund_paid is retired: raise a refund payment voucher (prepare_refund_voucher) and pay it from Billing · Payment vouchers'
    using errcode = 'check_violation';
end;
$fn$;
