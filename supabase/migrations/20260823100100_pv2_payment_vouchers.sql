-- Payment Vouchers · step 2 of 5 — table, counter, RLS, role documentation.
--
-- INVOICES & RECEIPTS = money IN.  PAYMENT VOUCHERS = money OUT.
-- Every ringgit that leaves MAS — examiner / instructor / hosting payouts under
-- CD-4, refunds on cancelled sessions, reimbursements, and miscellaneous
-- disbursements — is raised as a numbered, approved voucher. Paying a voucher
-- writes the existing payments(direction='payout') ledger row, so the money
-- ledger stays single-sourced; the voucher is the authorisation wrapper around
-- it.
--
-- Numbering: PV{MMYY}-{serial}, gapless, allocated ON APPROVAL (never on draft
-- creation) so an abandoned draft cannot burn a voucher number. Mirrors the
-- invoice_counter / receipt_counter pattern.
--
-- Prereq: step 1 (finance_approver enum label) applied and committed.

-- ============ 1 · membership scope: finance_approver is national ============
-- Mirrors the live CASE-role constraint, adding only the finance_approver branch.
alter table public.memberships drop constraint if exists memberships_scope_valid;
alter table public.memberships add constraint memberships_scope_valid check (
  case role
    when 'partner_center_admin'::membership_role then (partner_center_id is not null)
    when 'examiner'::membership_role then ((state is not null) and (partner_center_id is null))
    when 'board_member'::membership_role then (partner_center_id is null)
    when 'coaching_panel'::membership_role then (partner_center_id is null)
    when 'chairperson'::membership_role then (partner_center_id is null)
    when 'chief_examiner'::membership_role then (partner_center_id is null)
    when 'examiner_trainer'::membership_role then (partner_center_id is null)
    when 'master_trainer'::membership_role then (partner_center_id is null)
    when 'finance_officer'::membership_role then (partner_center_id is null)
    when 'finance_approver'::membership_role then (partner_center_id is null)
    else true
  end
);

-- ============ 2 · role_catalog documentation ============
-- Documentation only — real privilege lives in RLS + has_role().
-- finance_officer never got a catalog row when it was added; seed both.
insert into public.role_catalog (role, display_name, summary, responsibilities, who_invites, sort_order) values
 ('finance_officer','Finance Officer','Runs the money desk.','Records payments in against invoices, prepares payment vouchers for every disbursement, pays approved vouchers. Cannot approve a voucher they prepared.','Invited by the Chairperson.',95),
 ('finance_approver','Finance Approver','Second signature on money out.','Approves payment vouchers prepared by the Finance Officer. Approval allocates the PV number and authorises payment. Never prepares or pays a voucher they approved.','Invited by the Chairperson.',96)
on conflict (role) do nothing;

-- ============ 3 · gapless voucher counter ============
create table if not exists public.voucher_counter (
  id          boolean primary key default true,
  last_serial bigint  not null default 0,
  constraint voucher_counter_singleton check (id)
);
insert into public.voucher_counter (id, last_serial)
values (true, 0)
on conflict (id) do nothing;

alter table public.voucher_counter enable row level security;
-- Allocation happens inside a definer function; nobody touches this directly.
drop policy if exists voucher_counter_no_direct_access on public.voucher_counter;
create policy voucher_counter_no_direct_access on public.voucher_counter
  for all using (false) with check (false);

-- ============ 4 · payment_vouchers ============
create table if not exists public.payment_vouchers (
  id                uuid primary key default gen_random_uuid(),

  -- Allocated on approval only, hence nullable + unique (drafts have no number).
  voucher_no        text unique,

  category          text not null
                      check (category in ('examiner_payout','instructor_payout',
                                          'hosting_payout','refund',
                                          'reimbursement','other')),

  -- Payee: a portal profile where we have one, free text for external payees
  -- (a venue, a supplier, a parent who never made an account).
  payee_profile_id  uuid references public.profiles(id),
  payee_name        text,

  session_id        uuid references public.assessment_sessions(id) on delete set null,
  invoice_id        uuid references public.invoices(id) on delete set null,  -- refunds

  amount            numeric(10,2) not null check (amount > 0),
  currency          text not null default 'MYR',
  method            text,       -- transfer | qr | cash | …  (recorded on payment)
  reference         text,       -- transaction / payout proof reference
  memo              text,

  status            text not null default 'draft'
                      check (status in ('draft','approved','paid','void')),

  prepared_by       uuid references public.profiles(id),
  prepared_at       timestamptz not null default now(),
  approved_by       uuid references public.profiles(id),
  approved_at       timestamptz,
  paid_by           uuid references public.profiles(id),
  paid_at           timestamptz,
  void_reason       text,
  voided_by         uuid references public.profiles(id),
  voided_at         timestamptz,

  -- The payments(direction='payout') row this voucher produced when paid.
  payment_id        uuid references public.payments(id),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- A voucher must name a payee one way or the other.
  constraint payment_vouchers_payee_present
    check (payee_profile_id is not null or nullif(btrim(coalesce(payee_name,'')), '') is not null),
  -- An approved / paid voucher always carries its number.
  constraint payment_vouchers_numbered_when_approved
    check (status in ('draft','void') or voucher_no is not null)
);

create index if not exists payment_vouchers_status_idx  on public.payment_vouchers(status);
create index if not exists payment_vouchers_payee_idx   on public.payment_vouchers(payee_profile_id);
create index if not exists payment_vouchers_session_idx on public.payment_vouchers(session_id);
create index if not exists payment_vouchers_invoice_idx on public.payment_vouchers(invoice_id);

drop trigger if exists payment_vouchers_set_updated_at on public.payment_vouchers;
create trigger payment_vouchers_set_updated_at
  before update on public.payment_vouchers
  for each row execute function public.handle_updated_at();

comment on table public.payment_vouchers is
  'Money OUT. Every disbursement (payout / refund / reimbursement / other) is a numbered, approved voucher. Paying one writes payments(direction=''payout'') and links payment_id. Numbers PV{MMYY}-##### are allocated on approval, gapless.';

-- ============ 5 · RLS ============
-- Read: the finance desk, the approvers, governance — plus the payee's own
-- vouchers (an examiner may see what MAS raised in their name).
-- Write: definer RPCs only. No direct insert/update/delete from any client,
-- so the two-step lifecycle cannot be bypassed.
alter table public.payment_vouchers enable row level security;

drop policy if exists payment_vouchers_select on public.payment_vouchers;
create policy payment_vouchers_select on public.payment_vouchers
for select using (
  public.has_role('finance_officer')
  or public.has_role('finance_approver')
  or public.has_role('system_admin')
  or public.has_role('chairperson')
  or payee_profile_id = (select auth.uid())
);

drop policy if exists payment_vouchers_no_direct_write on public.payment_vouchers;
create policy payment_vouchers_no_direct_write on public.payment_vouchers
for all using (false) with check (false);
