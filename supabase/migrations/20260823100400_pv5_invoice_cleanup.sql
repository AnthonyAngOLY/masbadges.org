-- Payment Vouchers · step 5 of 5 — retire the dead money-IN paths and pin the
-- billing register read to what the screen actually renders.
--
-- Nothing here is load-bearing for the voucher module; apply it last, after
-- the front end that no longer calls record_examiner_payout / mark_refund_paid
-- has shipped.
--
-- What goes, and why:
--   record_invoice_payment   — superseded by record_payment (#14), which also
--                              mints the receipt, releases certificates and
--                              opens the session for pickup. The old one
--                              stamped a 'MAS-RCT-…' string into
--                              invoices.receipt_no, which now holds the
--                              INV{MMYY} invoice number — actively harmful.
--   build_session_invoice    — the #22 invoice builder, superseded by the
--                              stage-based engine (stage1_invoice_on_accept /
--                              submit_session_results / cert automation).
--                              Its only remaining job was reading
--                              assessment_fees.
--   assessment_fees          — duplicate of fee_schedule (the live source of
--                              per-level fees: RM50 L1-L3, RM75 L4-L7). Two
--                              fee tables is one too many.
--   record_examiner_payout   — replaced by the voucher lifecycle. Payouts are
--                              prepared, approved, then paid.
--   app_settings payout keys — the base+travel model that always evaluated to
--                              zero; CD-4 payout_schedule replaced it.

-- ============ 1 · dead invoice write paths ============
drop function if exists public.record_invoice_payment(uuid, numeric, text, text);
drop function if exists public.build_session_invoice(uuid);
drop table    if exists public.assessment_fees;

-- ============ 2 · dead payout write path ============
drop function if exists public.record_examiner_payout(uuid, numeric, text);

-- ============ 3 · dead payout config ============
delete from public.app_settings
 where key in ('examiner_base_per_candidate', 'examiner_travel_default');

-- ============ 4 · billing register read ============
-- Pins the tracked definition to what is ALREADY DEPLOYED, verbatim. The live
-- function had drifted ahead of this repo (it carries the last-payment columns
-- the register renders, and falls back to the bill-to's email when their
-- profile has no full_name). Applying this is a no-op against live — it exists
-- so the migration history stops lying about the billing read.
--
-- The signature is unchanged, so create-or-replace is enough; no drop, and no
-- window where the register's read is missing.
create or replace function public.list_billing_invoices()
 returns table(
   invoice_id          uuid,
   receipt_no          text,
   stage               text,
   status              text,
   total               numeric,
   paid_to_date        numeric,
   outstanding         numeric,
   session_id          uuid,
   venue               text,
   scheduled_on        date,
   session_status      public.session_status,
   bill_to_name        text,
   created_at          timestamptz,
   last_payment_ref    text,
   last_payment_method text,
   last_payment_at     timestamptz
 )
 language sql
 stable security definer
 set search_path to ''
as $fn$
  select
    i.id, i.receipt_no, i.stage, i.status, i.total,
    coalesce((select sum(p.amount) from public.payments p
              where p.invoice_id = i.id and p.direction = 'inbound'), 0) as paid_to_date,
    i.total - coalesce((select sum(p.amount) from public.payments p
              where p.invoice_id = i.id and p.direction = 'inbound'), 0) as outstanding,
    i.session_id, s.venue, s.scheduled_on, s.status,
    coalesce(nullif(trim(pr.full_name), ''), pr.email),
    i.created_at,
    lp.reference, lp.method, lp.recorded_at
  from public.invoices i
  left join public.assessment_sessions s on s.id = i.session_id
  left join public.profiles pr on pr.id = i.bill_to_profile_id
  left join lateral (
    select p.reference, p.method, p.recorded_at
    from public.payments p
    where p.invoice_id = i.id and p.direction = 'inbound'
    order by p.recorded_at desc
    limit 1
  ) lp on true
  where public.has_role('finance_officer') or public.has_role('system_admin')
        or public.has_role('chairperson')
  order by (i.status in ('pro_forma','issued')) desc, i.created_at desc;
$fn$;

grant execute on function public.list_billing_invoices() to authenticated;
