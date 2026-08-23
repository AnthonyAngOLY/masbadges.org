-- Payment Vouchers · step 1 of 5 — the finance_approver role label.
--
-- Money OUT gets separation of duties: the Finance Officer PREPARES a voucher,
-- a second person APPROVES it. finance_approver is that delegate approver
-- (the Chairperson and system_admin can also approve, so a small office does
-- not need a fourth person).
--
-- ADD VALUE must be isolated: the new label cannot be USED (as an enum literal)
-- in the same transaction that adds it. Everything that references
-- 'finance_approver' lives in step 2 onwards.
--
-- APPLY FIRST, on its own.

alter type public.membership_role add value if not exists 'finance_approver';
