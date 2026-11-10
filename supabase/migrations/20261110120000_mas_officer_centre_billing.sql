-- 20261110120000_mas_officer_centre_billing.sql
--
-- Lets the MAS Officer (Admin & Finance Officer, membership_role
-- 'finance_officer') raise and reconcile centre recognition invoices.
--
-- WHY: the Officer is the person who issues and collects invoices due to MAS
-- and reconciles the payments. They could already reach assessment billing
-- (/billing/payments) and the payment vouchers, but /admin/centre-billing
-- admitted only chairperson, board_member and system_admin — so the
-- centre-recognition half of the job was behind a door they could not open.
-- The route has been widened in src/App.tsx; this is the database half.
-- Without it the screen opens and every action on it is refused.
--
-- can_bill_centres() is the single gate for the whole centre-billing module:
-- create_centre_invoice, record_centre_payment, mark_centre_invoice_paid,
-- list_centre_billing, list_centres_due_renewal, lapse_expired_centres and
-- invite_centre_admin all call it. Widening it here widens all of them
-- together, which is the intent — raising an invoice you cannot then record
-- payment against would be useless.
--
-- ⚠ BEFORE RUNNING THIS, read the deployed definition. can_bill_centres() was
-- created in the SQL editor and never written back to git, so this file is
-- replacing a body that was never captured:
--
--   select pg_get_functiondef(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'can_bill_centres';
--
-- Read on 2026-11-10: the deployed body was exactly
--   select public.has_role('chairperson') or public.has_role('board_member')
--       or public.has_role('system_admin');
-- with LANGUAGE sql, STABLE and SET search_path TO ''. Adding finance_officer
-- is therefore purely additive, and this file reproduces the rest unchanged.

create or replace function public.can_bill_centres()
returns boolean
language sql
stable
-- Keep the search_path pinned. The deployed definition had it, 22 of the 23
-- captured functions have it, and dropping it on a replace is a silent
-- downgrade that nothing would have failed on.
set search_path to ''
as $function$
  select public.has_role('chairperson')
      or public.has_role('board_member')
      or public.has_role('system_admin')
      or public.has_role('finance_officer');
$function$;

-- Keep the deployed grants. has_role() reads auth.uid(), so an anonymous
-- caller gets false from every branch above.
grant execute on function public.can_bill_centres() to anon, authenticated, service_role;
