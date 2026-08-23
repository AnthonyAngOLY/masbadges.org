-- Payment Vouchers · step 3 of 5 — numbering, lifecycle RPCs, reads.
--
-- Lifecycle (separation of duties):
--   prepare_payment_voucher(...)          draft     finance_officer / system_admin / chairperson
--   approve_payment_voucher(id)           approved  finance_approver / chairperson / system_admin
--                                                   — approver MUST NOT be the preparer
--                                                   — allocates the gapless PV number here
--   pay_payment_voucher(id, method, ref)  paid      finance_officer / system_admin / chairperson
--                                                   — writes payments(direction='payout')
--   void_payment_voucher(id, reason)      void      from draft or approved only
--
-- Every transition is written to audit_log alongside the payments trigger, so
-- the money-out trail is complete even for a voucher that is never paid.
--
-- Prereq: step 2 applied and committed.

-- ============ 1 · gapless allocator ============
-- Locks the singleton counter row, increments, formats. SECURITY DEFINER so it
-- runs inside the approval function regardless of caller privilege; never
-- granted to clients.
create or replace function public.next_voucher_no()
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $fn$
declare
  v_serial bigint;
begin
  update public.voucher_counter
     set last_serial = last_serial + 1
   where id = true
  returning last_serial into v_serial;

  return 'PV' || to_char(now(), 'MMYY') || '-' || lpad(v_serial::text, 5, '0');
end;
$fn$;

revoke all on function public.next_voucher_no() from public, authenticated;

-- ============ 2 · role helpers ============
create or replace function public.can_prepare_vouchers()
 returns boolean
 language sql stable
 set search_path to ''
as $fn$
  select public.has_role('finance_officer')
      or public.has_role('system_admin')
      or public.has_role('chairperson');
$fn$;
grant execute on function public.can_prepare_vouchers() to authenticated;

create or replace function public.can_approve_vouchers()
 returns boolean
 language sql stable
 set search_path to ''
as $fn$
  select public.has_role('finance_approver')
      or public.has_role('chairperson')
      or public.has_role('system_admin');
$fn$;
grant execute on function public.can_approve_vouchers() to authenticated;

-- ============ 3 · prepare ============
create or replace function public.prepare_payment_voucher(
  _category         text,
  _amount           numeric,
  _payee_profile_id uuid default null,
  _payee_name       text default null,
  _session_id       uuid default null,
  _invoice_id       uuid default null,
  _memo             text default null,
  _currency         text default 'MYR'
) returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $fn$
declare
  v_me uuid := (select auth.uid());
  v_id uuid;
  v_payee_name text;
begin
  if not public.can_prepare_vouchers() then
    raise exception 'not authorized to prepare payment vouchers' using errcode = 'insufficient_privilege';
  end if;
  if _amount is null or _amount <= 0 then
    raise exception 'amount must be positive' using errcode = 'check_violation';
  end if;
  if _category is null or _category not in
     ('examiner_payout','instructor_payout','hosting_payout','refund','reimbursement','other') then
    raise exception 'unknown voucher category %', _category using errcode = 'check_violation';
  end if;

  v_payee_name := nullif(btrim(coalesce(_payee_name, '')), '');
  if _payee_profile_id is null and v_payee_name is null then
    raise exception 'a voucher needs a payee: either a portal profile or a payee name'
      using errcode = 'check_violation';
  end if;

  insert into public.payment_vouchers
    (category, payee_profile_id, payee_name, session_id, invoice_id,
     amount, currency, memo, status, prepared_by, prepared_at)
  values
    (_category, _payee_profile_id, v_payee_name, _session_id, _invoice_id,
     _amount, coalesce(nullif(btrim(coalesce(_currency,'')), ''), 'MYR'),
     nullif(btrim(coalesce(_memo,'')), ''), 'draft', v_me, now())
  returning id into v_id;

  insert into public.audit_log (actor_profile_id, action, object_type, object_id, session_id, detail)
  values (v_me, 'voucher_prepared', 'payment_voucher', v_id, _session_id,
          jsonb_build_object('category', _category, 'amount', _amount,
                             'invoice_id', _invoice_id, 'payee_profile_id', _payee_profile_id,
                             'payee_name', v_payee_name));

  return jsonb_build_object('voucher_id', v_id, 'status', 'draft', 'voucher_no', null);
end;
$fn$;

grant execute on function public.prepare_payment_voucher(text, numeric, uuid, text, uuid, uuid, text, text) to authenticated;

-- ============ 4 · approve (allocates the number) ============
create or replace function public.approve_payment_voucher(_voucher_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $fn$
declare
  v_me       uuid := (select auth.uid());
  v_status   text;
  v_prepared uuid;
  v_no       text;
begin
  if not public.can_approve_vouchers() then
    raise exception 'not authorized to approve payment vouchers' using errcode = 'insufficient_privilege';
  end if;

  select status, prepared_by
    into v_status, v_prepared
    from public.payment_vouchers
   where id = _voucher_id
   for update;

  if v_status is null then
    raise exception 'voucher not found';
  end if;
  if v_status <> 'draft' then
    raise exception 'only a draft voucher can be approved (this one is %)', v_status
      using errcode = 'check_violation';
  end if;

  -- Separation of duties: the approver is never the preparer, whatever roles
  -- they hold (the system_admin wildcard does not buy an exemption).
  if v_prepared is not null and v_prepared = v_me then
    raise exception 'separation of duties: a voucher cannot be approved by the person who prepared it'
      using errcode = 'check_violation';
  end if;

  v_no := public.next_voucher_no();

  update public.payment_vouchers
     set status      = 'approved',
         voucher_no  = v_no,
         approved_by = v_me,
         approved_at = now()
   where id = _voucher_id;

  insert into public.audit_log (actor_profile_id, action, object_type, object_id, session_id, detail)
  select v_me, 'voucher_approved', 'payment_voucher', pv.id, pv.session_id,
         jsonb_build_object('voucher_no', pv.voucher_no, 'category', pv.category,
                            'amount', pv.amount, 'prepared_by', pv.prepared_by)
    from public.payment_vouchers pv where pv.id = _voucher_id;

  return jsonb_build_object('voucher_id', _voucher_id, 'status', 'approved', 'voucher_no', v_no);
end;
$fn$;

grant execute on function public.approve_payment_voucher(uuid) to authenticated;

-- ============ 5 · pay (writes the payments ledger) ============
create or replace function public.pay_payment_voucher(
  _voucher_id uuid, _method text default null, _reference text default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $fn$
declare
  v_me      uuid := (select auth.uid());
  v         public.payment_vouchers;
  v_payment uuid;
  v_note    text;
begin
  if not public.can_prepare_vouchers() then
    raise exception 'not authorized to pay payment vouchers' using errcode = 'insufficient_privilege';
  end if;

  select * into v from public.payment_vouchers where id = _voucher_id for update;

  if v.id is null then
    raise exception 'voucher not found';
  end if;
  if v.status <> 'approved' then
    raise exception 'only an approved voucher can be paid (this one is %)', v.status
      using errcode = 'check_violation';
  end if;

  -- note keeps the existing refund arithmetic (list_refunds_due) working and
  -- tags every other payout with the category that authorised it.
  v_note := case when v.category = 'refund' then 'refund' else v.category end;

  insert into public.payments
    (direction, invoice_id, session_id, payee_profile_id, amount, method, reference,
     recorded_by_profile_id, note)
  values
    ('payout', v.invoice_id, v.session_id, v.payee_profile_id, v.amount,
     coalesce(_method, v.method), nullif(btrim(coalesce(_reference, v.reference, '')), ''),
     v_me, v_note)
  returning id into v_payment;

  update public.payment_vouchers
     set status     = 'paid',
         method     = coalesce(_method, method),
         reference  = coalesce(nullif(btrim(coalesce(_reference,'')), ''), reference),
         paid_by    = v_me,
         paid_at    = now(),
         payment_id = v_payment
   where id = _voucher_id;

  insert into public.audit_log (actor_profile_id, action, object_type, object_id, session_id, detail)
  values (v_me, 'voucher_paid', 'payment_voucher', _voucher_id, v.session_id,
          jsonb_build_object('voucher_no', v.voucher_no, 'category', v.category,
                             'amount', v.amount, 'payment_id', v_payment,
                             'method', coalesce(_method, v.method), 'reference', _reference));

  return jsonb_build_object(
    'voucher_id', _voucher_id, 'voucher_no', v.voucher_no,
    'status', 'paid', 'payment_id', v_payment, 'amount', v.amount);
end;
$fn$;

grant execute on function public.pay_payment_voucher(uuid, text, text) to authenticated;

-- ============ 6 · void ============
-- A paid voucher is never voided — the money moved. Reverse it with a fresh
-- voucher (or an inbound payment) so both legs stay on the record.
create or replace function public.void_payment_voucher(_voucher_id uuid, _reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $fn$
declare
  v_me     uuid := (select auth.uid());
  v_status text;
  v_no     text;
  v_session uuid;
begin
  if not (public.can_prepare_vouchers() or public.can_approve_vouchers()) then
    raise exception 'not authorized to void payment vouchers' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(_reason, '')), '') is null then
    raise exception 'a void needs a reason' using errcode = 'check_violation';
  end if;

  select status, voucher_no, session_id
    into v_status, v_no, v_session
    from public.payment_vouchers where id = _voucher_id for update;

  if v_status is null then
    raise exception 'voucher not found';
  end if;
  if v_status not in ('draft', 'approved') then
    raise exception 'only a draft or approved voucher can be voided (this one is %)', v_status
      using errcode = 'check_violation';
  end if;

  update public.payment_vouchers
     set status      = 'void',
         void_reason = btrim(_reason),
         voided_by   = v_me,
         voided_at   = now()
   where id = _voucher_id;

  insert into public.audit_log (actor_profile_id, action, object_type, object_id, session_id, detail)
  values (v_me, 'voucher_voided', 'payment_voucher', _voucher_id, v_session,
          jsonb_build_object('voucher_no', v_no, 'from_status', v_status, 'reason', btrim(_reason)));

  return jsonb_build_object('voucher_id', _voucher_id, 'status', 'void', 'voucher_no', v_no);
end;
$fn$;

grant execute on function public.void_payment_voucher(uuid, text) to authenticated;

-- ============ 7 · reads ============
-- The register. Finance desk / approvers / governance see everything; a payee
-- sees their own vouchers only.
create or replace function public.list_payment_vouchers()
 returns table(
   voucher_id     uuid,
   voucher_no     text,
   category       text,
   status         text,
   amount         numeric,
   currency       text,
   payee_name     text,
   payee_profile_id uuid,
   session_id     uuid,
   venue          text,
   scheduled_on   date,
   invoice_id     uuid,
   invoice_no     text,
   method         text,
   reference      text,
   memo           text,
   prepared_by_name text,
   prepared_at    timestamptz,
   approved_by_name text,
   approved_at    timestamptz,
   paid_at        timestamptz,
   void_reason    text,
   can_approve    boolean
 )
 language sql
 stable security definer
 set search_path to ''
as $fn$
  select
    pv.id, pv.voucher_no, pv.category, pv.status, pv.amount, pv.currency,
    coalesce(pp.full_name, pp.email, pv.payee_name) as payee_name,
    pv.payee_profile_id,
    pv.session_id, s.venue, s.scheduled_on,
    pv.invoice_id, i.receipt_no,
    pv.method, pv.reference, pv.memo,
    coalesce(prep.full_name, prep.email), pv.prepared_at,
    coalesce(appr.full_name, appr.email), pv.approved_at,
    pv.paid_at, pv.void_reason,
    -- The approve control only lights up for someone who may actually approve
    -- THIS voucher: an approver who did not prepare it.
    (pv.status = 'draft'
      and public.can_approve_vouchers()
      and pv.prepared_by is distinct from auth.uid()) as can_approve
  from public.payment_vouchers pv
  left join public.profiles pp   on pp.id = pv.payee_profile_id
  left join public.profiles prep on prep.id = pv.prepared_by
  left join public.profiles appr on appr.id = pv.approved_by
  left join public.assessment_sessions s on s.id = pv.session_id
  left join public.invoices i on i.id = pv.invoice_id
  where public.has_role('finance_officer')
     or public.has_role('finance_approver')
     or public.has_role('system_admin')
     or public.has_role('chairperson')
     or pv.payee_profile_id = auth.uid()
  order by
    case pv.status when 'draft' then 0 when 'approved' then 1 when 'paid' then 2 else 3 end,
    pv.prepared_at desc;
$fn$;

grant execute on function public.list_payment_vouchers() to authenticated;

-- Nav badge: drafts this person could actually approve (never their own).
create or replace function public.count_pending_voucher_approvals()
 returns integer
 language sql
 stable security definer
 set search_path to ''
as $fn$
  select case
    when public.can_approve_vouchers()
    then (select count(*)::int from public.payment_vouchers pv
           where pv.status = 'draft'
             and pv.prepared_by is distinct from auth.uid())
    else 0
  end;
$fn$;

grant execute on function public.count_pending_voucher_approvals() to authenticated;

-- The A5 printable. Reuses org_finance_settings for the MAS payer block, the
-- same singleton the invoice document reads through get_finance_settings().
create or replace function public.get_voucher_document(_voucher_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $fn$
declare
  v jsonb;
  v_payee uuid;
begin
  select payee_profile_id into v_payee
    from public.payment_vouchers where id = _voucher_id;

  if not exists (select 1 from public.payment_vouchers where id = _voucher_id) then
    raise exception 'voucher not found';
  end if;

  if not (public.has_role('finance_officer') or public.has_role('finance_approver')
          or public.has_role('system_admin') or public.has_role('chairperson')
          or v_payee = (select auth.uid())) then
    raise exception 'not authorized to view this voucher' using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'voucher_no', pv.voucher_no,
    'category', pv.category,
    'status', pv.status,
    'amount', pv.amount,
    'currency', pv.currency,
    'method', pv.method,
    'reference', pv.reference,
    'memo', pv.memo,
    'payee_name', coalesce(pp.full_name, pp.email, pv.payee_name),
    'payee_email', pp.email,
    'session_venue', s.venue,
    'session_date', s.scheduled_on,
    'centre_name', pc.name,
    'invoice_no', i.receipt_no,
    'prepared_by', coalesce(prep.full_name, prep.email),
    'prepared_at', pv.prepared_at,
    'approved_by', coalesce(appr.full_name, appr.email),
    'approved_at', pv.approved_at,
    'paid_by', coalesce(payr.full_name, payr.email),
    'paid_at', pv.paid_at,
    'void_reason', pv.void_reason,
    'payer', (
      select jsonb_build_object(
        'beneficiary_name', o.beneficiary_name,
        'bank_name', o.bank_name,
        'account_myr', o.account_myr,
        'finance_email', o.finance_email,
        'finance_pic', o.finance_pic)
      from public.org_finance_settings o limit 1)
  ) into v
  from public.payment_vouchers pv
  left join public.profiles pp   on pp.id = pv.payee_profile_id
  left join public.profiles prep on prep.id = pv.prepared_by
  left join public.profiles appr on appr.id = pv.approved_by
  left join public.profiles payr on payr.id = pv.paid_by
  left join public.assessment_sessions s on s.id = pv.session_id
  left join public.partner_centers pc on pc.id = s.partner_center_id
  left join public.invoices i on i.id = pv.invoice_id
  where pv.id = _voucher_id;

  return v;
end;
$fn$;

grant execute on function public.get_voucher_document(uuid) to authenticated;
