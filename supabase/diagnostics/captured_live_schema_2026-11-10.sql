-- ============================================================================
-- captured_live_schema_2026-11-10.sql
--
-- Live definitions pulled out of masbadges-web with dump_live_schema.sql
-- PARTS 2-6 on 2026-11-10. This is the CAPTURE RECORD, deliberately kept in
-- diagnostics/ rather than migrations/: see "NOT YET RUNNABLE" below.
--
-- Everything here is the live database's own output from pg_get_functiondef,
-- pg_get_constraintdef, pg_get_indexdef and pg_policies. Where it disagrees
-- with a file in supabase/migrations/, THIS is what is actually running.
--
-- NOT YET RUNNABLE AS A MIGRATION. It depends on gate functions that are
-- themselves untracked and were missed by the capture — can_bill_centres(),
-- can_manage_store(), is_store_staff(), next_store_order_no() — and on the
-- store_order_status enum, which PART 7 would have given us. PART 8 of the
-- dump script collects the remainder; once that is in, this splits into real
-- migration files per subsystem.
--
-- WHY THE CAPTURE WAS INCOMPLETE: the name arrays in dump_live_schema.sql were
-- written BEFORE the PART 1 inventory told us what was actually missing, and
-- were never widened afterwards. 21 of the 33 untracked functions and 7 of the
-- 10 untracked tables came back. The gap is listed at the end of this file.
-- ============================================================================


-- ============================================================================
-- SECURITY FINDING — unauthenticated read of the organisation's bank details
--
-- get_finance_settings() is SECURITY DEFINER, performs NO authorisation check,
-- and is granted EXECUTE to anon (the key shipped in the public frontend
-- bundle). It returns beneficiary name, bank name and address, MYR and USD
-- account numbers, SWIFT code, finance email and finance PIC.
--
-- org_finance_settings' own RLS policy restricts SELECT to auth.uid() IS NOT
-- NULL, so the function is a hole around the table's own rule.
--
-- Suggested remediation is at the bottom of this file, NOT applied here.
-- Two lesser cases of the same shape: list_centre_fee_catalog() and
-- list_store_products() are also ungated and granted to anon.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. CENTRE-RECOGNITION BILLING — tables
-- ----------------------------------------------------------------------------

create table if not exists public.centre_fee_catalog (
  code text not null,
  label text not null,
  default_amount numeric(10,2) default 0 not null,
  active boolean default true not null,
  sort_order integer default 100 not null
);
alter table public.centre_fee_catalog
  add constraint centre_fee_catalog_pkey primary key (code);
alter table public.centre_fee_catalog enable row level security;
-- NOTE: RLS on, and PART 6 returned NO policies for this table. Every read
-- therefore goes through the security-definer RPCs; direct access is denied to
-- anon and authenticated alike. Same for centre_invoices and
-- centre_invoice_items below. That is coherent, not an oversight.

create table if not exists public.centre_invoices (
  id uuid default gen_random_uuid() not null,
  partner_center_id uuid not null,
  status text default 'outstanding'::text not null,
  total_amount numeric(10,2) default 0 not null,
  currency text default 'MYR'::text not null,
  period_start date,
  period_end date,
  note text,
  issued_by_profile_id uuid,
  issued_at timestamp with time zone default now() not null,
  paid_at timestamp with time zone
);
alter table public.centre_invoices
  add constraint centre_invoices_pkey primary key (id);
alter table public.centre_invoices
  add constraint centre_invoices_partner_center_id_fkey
  foreign key (partner_center_id) references public.partner_centers(id);
alter table public.centre_invoices
  add constraint centre_invoices_issued_by_profile_id_fkey
  foreign key (issued_by_profile_id) references public.profiles(id);
alter table public.centre_invoices
  add constraint centre_invoices_status_check
  check ((status = any (array['outstanding'::text, 'paid'::text, 'cancelled'::text])));
alter table public.centre_invoices enable row level security;

create table if not exists public.centre_invoice_items (
  id uuid default gen_random_uuid() not null,
  centre_invoice_id uuid not null,
  label text not null,
  amount numeric(10,2) default 0 not null
);
alter table public.centre_invoice_items
  add constraint centre_invoice_items_pkey primary key (id);
alter table public.centre_invoice_items
  add constraint centre_invoice_items_centre_invoice_id_fkey
  foreign key (centre_invoice_id) references public.centre_invoices(id) on delete cascade;
alter table public.centre_invoice_items enable row level security;

-- MISSING: centre_payments and centre_invitations. Both are referenced by the
-- functions below (and by list_centre_billing's paid-amount subquery) but were
-- not in the capture's table array. PART 8 collects them.


-- ----------------------------------------------------------------------------
-- 2. ORG FINANCE SETTINGS — table + policies
-- ----------------------------------------------------------------------------

create table if not exists public.org_finance_settings (
  id text default 'default'::text not null,
  beneficiary_name text not null,
  bank_name text not null,
  bank_address text,
  account_myr text,
  account_usd text,
  swift_code text,
  finance_email text,
  finance_pic text,
  pay_note text,
  updated_at timestamp with time zone default now() not null,
  updated_by uuid
);
alter table public.org_finance_settings
  add constraint org_finance_settings_pkey primary key (id);
alter table public.org_finance_settings
  add constraint org_finance_settings_id_check check ((id = 'default'::text));
alter table public.org_finance_settings
  add constraint org_finance_settings_updated_by_fkey
  foreign key (updated_by) references public.profiles(id);
alter table public.org_finance_settings enable row level security;

create policy ofs_select on public.org_finance_settings
  as permissive for select to public
  using ((auth.uid() is not null));

create policy ofs_write on public.org_finance_settings
  as permissive for all to public
  using ((has_role('system_admin'::membership_role)
       or has_role('chairperson'::membership_role)
       or has_role('finance_officer'::membership_role)))
  with check ((has_role('system_admin'::membership_role)
            or has_role('chairperson'::membership_role)
            or has_role('finance_officer'::membership_role)));


-- ----------------------------------------------------------------------------
-- 3. STORE — tables
-- ----------------------------------------------------------------------------

create table if not exists public.store_products (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text not null,
  description text,
  category text,
  unit_price numeric(10,2) default 0 not null,
  currency text default 'MYR'::text not null,
  active boolean default true not null,
  sort_order integer default 100 not null,
  image_paths text[] default '{}'::text[] not null,
  stock_qty integer,
  updated_at timestamp with time zone default now() not null,
  sku text
);
alter table public.store_products add constraint store_products_pkey primary key (id);
alter table public.store_products add constraint store_products_code_key unique (code);
alter table public.store_products add constraint store_products_stock_qty_chk
  check (((stock_qty is null) or (stock_qty >= 0)));
create index if not exists store_products_sku_idx
  on public.store_products using btree (sku) where (sku is not null);
alter table public.store_products enable row level security;

create policy store_products_read on public.store_products
  as permissive for select to authenticated using ((active or is_store_staff()));
create policy store_products_insert on public.store_products
  as permissive for insert to authenticated
  with check ((has_role('system_admin'::membership_role) or has_role('finance_officer'::membership_role)));
create policy store_products_update on public.store_products
  as permissive for update to authenticated
  using ((has_role('system_admin'::membership_role) or has_role('finance_officer'::membership_role)))
  with check ((has_role('system_admin'::membership_role) or has_role('finance_officer'::membership_role)));
create policy store_products_delete on public.store_products
  as permissive for delete to authenticated
  using ((has_role('system_admin'::membership_role) or has_role('finance_officer'::membership_role)));

-- store_orders.status uses the store_order_status enum, and order_no defaults
-- to next_store_order_no(). NEITHER IS CAPTURED YET — PART 7 (enums) and
-- PART 8 (functions) supply them, so this CREATE cannot run on its own.
create table if not exists public.store_orders (
  id uuid default gen_random_uuid() not null,
  ordered_by_profile_id uuid not null,
  partner_center_id uuid,
  status public.store_order_status default 'submitted'::public.store_order_status not null,
  total_amount numeric(10,2) default 0 not null,
  currency text default 'MYR'::text not null,
  shipping_address text,
  note text,
  tracking text,
  created_at timestamp with time zone default now() not null,
  paid_at timestamp with time zone,
  fulfilled_at timestamp with time zone,
  order_no text default public.next_store_order_no(),
  recipient_name text,
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state public.my_state,
  postcode text,
  invoice_no text,
  invoice_amount numeric(10,2),
  invoiced_at timestamp with time zone,
  invoiced_by uuid,
  paid_by uuid,
  payment_ref text,
  shipped_by uuid,
  cancelled_at timestamp with time zone,
  cancelled_by uuid,
  cancel_reason text
);
alter table public.store_orders add constraint store_orders_pkey primary key (id);
alter table public.store_orders add constraint store_orders_order_no_key unique (order_no);
alter table public.store_orders add constraint store_orders_invoice_no_key unique (invoice_no);
alter table public.store_orders add constraint store_orders_ordered_by_profile_id_fkey
  foreign key (ordered_by_profile_id) references public.profiles(id);
alter table public.store_orders add constraint store_orders_partner_center_id_fkey
  foreign key (partner_center_id) references public.partner_centers(id);
alter table public.store_orders add constraint store_orders_invoiced_by_fkey
  foreign key (invoiced_by) references public.profiles(id);
alter table public.store_orders add constraint store_orders_paid_by_fkey
  foreign key (paid_by) references public.profiles(id);
alter table public.store_orders add constraint store_orders_shipped_by_fkey
  foreign key (shipped_by) references public.profiles(id);
alter table public.store_orders add constraint store_orders_cancelled_by_fkey
  foreign key (cancelled_by) references public.profiles(id);
alter table public.store_orders add constraint store_orders_invoice_amount_chk
  check (((invoice_amount is null) or (invoice_amount >= (0)::numeric)));
alter table public.store_orders add constraint store_orders_note_len_chk
  check (((note is null) or (char_length(note) <= 200)));
create index if not exists store_orders_ordered_by_idx
  on public.store_orders using btree (ordered_by_profile_id);
create index if not exists store_orders_status_idx
  on public.store_orders using btree (status);
alter table public.store_orders enable row level security;

create policy store_orders_read on public.store_orders
  as permissive for select to authenticated
  using (((ordered_by_profile_id = auth.uid()) or is_store_staff()));

create table if not exists public.store_order_items (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  product_id uuid,
  label text not null,
  quantity integer default 1 not null,
  unit_price numeric(10,2) default 0 not null,
  line_total numeric(10,2) default 0 not null
);
alter table public.store_order_items add constraint store_order_items_pkey primary key (id);
alter table public.store_order_items add constraint store_order_items_order_product_uniq
  unique (order_id, product_id);
alter table public.store_order_items add constraint store_order_items_order_id_fkey
  foreign key (order_id) references public.store_orders(id) on delete cascade;
alter table public.store_order_items add constraint store_order_items_product_id_fkey
  foreign key (product_id) references public.store_products(id);
create index if not exists store_order_items_order_idx
  on public.store_order_items using btree (order_id);
alter table public.store_order_items enable row level security;

create policy store_order_items_read on public.store_order_items
  as permissive for select to authenticated
  using ((exists ( select 1 from public.store_orders o
                   where ((o.id = store_order_items.order_id)
                      and ((o.ordered_by_profile_id = auth.uid()) or is_store_staff())))));

-- MISSING: store_payments. Referenced by mark_store_order_paid() and
-- record_store_payment() below. PART 8 collects it.


-- ----------------------------------------------------------------------------
-- 4. FUNCTIONS — verbatim pg_get_functiondef output
--    Grants follow in section 5. Read the SECURITY FINDING note above before
--    re-applying get_finance_settings as-is.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_create_account_with_password(p_email text, p_password text, p_role membership_role, p_state my_state DEFAULT NULL::my_state, p_full_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := gen_random_uuid();
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (public.has_role('system_admin') or public.has_role('chairperson')) then
    raise exception 'only system_admin or chairperson may create accounts'
      using errcode = 'insufficient_privilege';
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'password must be at least 8 characters';
  end if;
  if exists (select 1 from auth.users where email = lower(p_email)) then
    raise exception 'an account already exists for %', lower(p_email) using errcode = '23505';
  end if;
  if p_role = 'examiner' and p_state is null then
    raise exception 'examiner role requires a state' using errcode = '23514';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    lower(p_email),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name),
    '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_uid, v_uid::text,
    jsonb_build_object('sub', v_uid::text, 'email', lower(p_email), 'email_verified', true),
    'email', now(), now(), now()
  );

  update public.profiles set full_name = coalesce(p_full_name, full_name)
   where id = v_uid;

  insert into public.memberships (profile_id, role, status, state)
  values (v_uid, p_role, 'active', p_state);

  return v_uid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_centre_invoice(_centre uuid, _period_start date, _period_end date, _items jsonb, _note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare _inv uuid; _total numeric(10,2) := 0; _it jsonb;
begin
  if not public.can_bill_centres() then raise exception 'Not authorised to invoice centres.'; end if;
  if _items is null or jsonb_array_length(_items) = 0 then raise exception 'Add at least one line item.'; end if;

  insert into public.centre_invoices(partner_center_id, period_start, period_end, note, issued_by_profile_id)
  values (_centre, _period_start, _period_end, nullif(trim(coalesce(_note,'')),''), auth.uid())
  returning id into _inv;

  for _it in select * from jsonb_array_elements(_items) loop
    insert into public.centre_invoice_items(centre_invoice_id, label, amount)
    values (_inv, _it->>'label', (_it->>'amount')::numeric);
    _total := _total + (_it->>'amount')::numeric;
  end loop;

  update public.centre_invoices set total_amount = _total where id = _inv;
  return _inv;
end;
$function$;

CREATE OR REPLACE FUNCTION public.find_profile_by_email(_email text)
 RETURNS TABLE(profile_id uuid, full_name text, email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.id, p.full_name, p.email
  from public.profiles p
  where lower(p.email) = lower(trim(_email))
    and (
      public.has_role('chairperson')
      or public.has_role('board_member')
      or public.has_role('chief_examiner')
    );
$function$;

CREATE OR REPLACE FUNCTION public.fulfil_store_order(_order uuid, _tracking text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.can_manage_store() then raise exception 'Not authorised.'; end if;
  update public.store_orders
     set status = 'fulfilled', fulfilled_at = now(), tracking = nullif(trim(coalesce(_tracking,'')),'')
   where id = _order and status = 'paid';
end;
$function$;

-- !! UNGATED + GRANTED TO anon. See SECURITY FINDING at the top of this file.
CREATE OR REPLACE FUNCTION public.get_finance_settings()
 RETURNS TABLE(beneficiary_name text, bank_name text, bank_address text, account_myr text, account_usd text, swift_code text, finance_email text, finance_pic text, pay_note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select beneficiary_name, bank_name, bank_address, account_myr, account_usd,
         swift_code, finance_email, finance_pic, pay_note
  from public.org_finance_settings
  where id = 'default';
$function$;

CREATE OR REPLACE FUNCTION public.invite_centre_admin(_centre uuid, _email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.can_bill_centres() then
    raise exception 'Only the Chairperson, board, or admin can invite a centre administrator.';
  end if;
  if position('@' in coalesce(_email, '')) = 0 then raise exception 'A valid email is required.'; end if;
  if exists (select 1 from public.centre_invitations
             where partner_center_id = _centre and lower(email) = lower(_email) and status = 'pending') then
    return;  -- already pending; idempotent
  end if;
  insert into public.centre_invitations(partner_center_id, email, invited_by_profile_id, status)
  values (_centre, lower(trim(_email)), auth.uid(), 'pending');
end;
$function$;

CREATE OR REPLACE FUNCTION public.lapse_expired_centres()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare _n int;
begin
  if not public.can_bill_centres() then raise exception 'Not authorised.'; end if;
  with lapsed as (
    update public.partner_centers
       set status = 'suspended'
     where status = 'recognized'
       and valid_until is not null
       and valid_until < current_date
     returning 1
  )
  select count(*) into _n from lapsed;
  return _n;
end;
$function$;

-- DRIFTED: has a migration, but the deployed version below returns
-- last_payment_ref / last_payment_method / last_payment_at and session_status,
-- none of which the committed file declares. This is the real one.
CREATE OR REPLACE FUNCTION public.list_billing_invoices()
 RETURNS TABLE(invoice_id uuid, receipt_no text, stage text, status text, total numeric, paid_to_date numeric, outstanding numeric, session_id uuid, venue text, scheduled_on date, session_status session_status, bill_to_name text, created_at timestamp with time zone, last_payment_ref text, last_payment_method text, last_payment_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.list_centre_billing()
 RETURNS TABLE(centre_id uuid, centre_name text, state my_state, poc_email text, approved_at timestamp with time zone, invoice_id uuid, invoice_status text, total_amount numeric, paid_amount numeric, period_end date, centre_status partner_center_status, valid_until date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select pc.id, pc.name, pc.state, a.poc_email, a.decided_at,
         ci.id, ci.status, ci.total_amount,
         coalesce((select sum(p.amount) from public.centre_payments p where p.centre_invoice_id = ci.id), 0),
         ci.period_end, pc.status, pc.valid_until
  from public.partner_applications a
  join public.partner_centers pc on pc.id = a.partner_center_id
  left join lateral (
    select * from public.centre_invoices c
    where c.partner_center_id = pc.id and c.status <> 'cancelled'
    order by c.issued_at desc limit 1
  ) ci on true
  where a.status = 'approved' and public.can_bill_centres()
  order by case when ci.id is null then 0 when ci.status = 'outstanding' then 1 else 2 end, a.decided_at desc;
$function$;

-- !! UNGATED + GRANTED TO anon (fee schedule readable by the public).
CREATE OR REPLACE FUNCTION public.list_centre_fee_catalog()
 RETURNS SETOF centre_fee_catalog
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select * from public.centre_fee_catalog where active order by sort_order; $function$;

CREATE OR REPLACE FUNCTION public.list_centres_due_renewal(_within_days integer DEFAULT 60)
 RETURNS TABLE(id uuid, name text, state my_state, status partner_center_status, valid_until date, days_left integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select pc.id, pc.name, pc.state, pc.status, pc.valid_until, (pc.valid_until - current_date)
  from public.partner_centers pc
  where public.can_bill_centres()
    and pc.status in ('recognized', 'suspended')
    and pc.valid_until is not null
    and pc.valid_until <= current_date + _within_days
  order by pc.valid_until asc;
$function$;

CREATE OR REPLACE FUNCTION public.list_memberships()
 RETURNS TABLE(membership_id uuid, profile_id uuid, full_name text, email text, role membership_role, status membership_status, state my_state, partner_center_id uuid, expires_at date, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select m.id, p.id, p.full_name, p.email, m.role, m.status,
         m.state, m.partner_center_id, m.expires_at, m.created_at
  from public.memberships m
  join public.profiles p on p.id = m.profile_id
  where public.has_role('chairperson')
     or public.has_role('board_member')
     or public.has_role('chief_examiner');
$function$;

-- DRIFTED: deployed version returns session_status, which the committed file
-- does not declare.
CREATE OR REPLACE FUNCTION public.list_my_invoices()
 RETURNS TABLE(invoice_id uuid, session_id uuid, status text, total numeric, currency text, receipt_no text, paid_at timestamp with time zone, venue text, scheduled_on date, created_at timestamp with time zone, session_status session_status)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select i.id, i.session_id, i.status, i.total, i.currency, i.receipt_no, i.paid_at,
         s.venue, s.scheduled_on, i.created_at, s.status
  from public.invoices i
  join public.assessment_sessions s on s.id = i.session_id
  where i.bill_to_profile_id = (select auth.uid())
     or (i.partner_center_id is not null
         and public.has_role('partner_center_admin', i.partner_center_id))
  order by i.created_at desc;
$function$;

-- NOT security definer, and harmless: it only unnests an enum.
CREATE OR REPLACE FUNCTION public.list_states()
 RETURNS TABLE(state my_state)
 LANGUAGE sql
 STABLE
AS $function$ select unnest(enum_range(null::public.my_state)); $function$;

-- !! Ungated for the `active` branch and granted to anon (catalogue + prices).
CREATE OR REPLACE FUNCTION public.list_store_products(_include_inactive boolean DEFAULT false)
 RETURNS SETOF store_products
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select * from public.store_products
  where (_include_inactive and public.can_manage_store()) or active
  order by sort_order, name;
$function$;

CREATE OR REPLACE FUNCTION public.mark_centre_invoice_paid(_invoice uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare _centre uuid; _end date; _paid numeric; _total numeric;
begin
  if not public.can_bill_centres() then raise exception 'Not authorised.'; end if;
  select partner_center_id, period_end, total_amount into _centre, _end, _total
    from public.centre_invoices where id = _invoice;
  if not found then raise exception 'Invoice not found.'; end if;

  select coalesce(sum(amount),0) into _paid from public.centre_payments where centre_invoice_id = _invoice;
  if _paid < _total then
    raise exception 'Recorded payments (%.2f) are less than the invoice total (%.2f). Record the payment first.', _paid, _total;
  end if;

  update public.centre_invoices set status = 'paid', paid_at = now() where id = _invoice;
  update public.partner_centers
     set status = 'recognized',
         recognized_at = current_date,
         valid_until = coalesce(_end, current_date + interval '1 year')
   where id = _centre;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_store_order_paid(_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare _paid numeric; _total numeric;
begin
  if not public.can_manage_store() then raise exception 'Not authorised.'; end if;
  select total_amount into _total from public.store_orders where id = _order;
  select coalesce(sum(amount),0) into _paid from public.store_payments where order_id = _order;
  if _paid < _total then raise exception 'Recorded payments are less than the order total.'; end if;
  update public.store_orders set status = 'paid', paid_at = now() where id = _order and status = 'placed';
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_centre_payment(_invoice uuid, _method text, _amount numeric, _reference text DEFAULT NULL::text, _proof_url text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.can_bill_centres() then raise exception 'Not authorised to record centre payments.'; end if;
  insert into public.centre_payments(centre_invoice_id, method, amount, reference, proof_url, recorded_by_profile_id)
  values (_invoice, _method, _amount, nullif(trim(coalesce(_reference,'')),''), nullif(trim(coalesce(_proof_url,'')),''), auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_store_payment(_order uuid, _method text, _amount numeric, _reference text DEFAULT NULL::text, _proof_url text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.can_manage_store() then raise exception 'Not authorised.'; end if;
  insert into public.store_payments(order_id, method, amount, reference, proof_url, recorded_by_profile_id)
  values (_order, _method, _amount, nullif(trim(coalesce(_reference,'')),''), nullif(trim(coalesce(_proof_url,'')),''), auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_store_product(_code text, _name text, _category text, _unit_price numeric, _description text DEFAULT NULL::text, _active boolean DEFAULT true, _sort_order integer DEFAULT 100)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.can_manage_store() then raise exception 'Not authorised to manage the catalogue.'; end if;
  insert into public.store_products(code, name, category, unit_price, description, active, sort_order)
  values (_code, _name, _category, _unit_price, _description, _active, _sort_order)
  on conflict (code) do update
    set name=excluded.name, category=excluded.category, unit_price=excluded.unit_price,
        description=excluded.description, active=excluded.active, sort_order=excluded.sort_order;
end;
$function$;

CREATE OR REPLACE FUNCTION public.preview_roster_swimmers(_swimmer_ids text[])
 RETURNS TABLE(input_id text, found boolean, candidate_id uuid, swimmer_id text, full_name text, date_of_birth date, current_level badge_level, next_level badge_level, next_fee numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_levels public.badge_level[] := enum_range(null::public.badge_level);
begin
  if not (public.has_role('instructor') or public.has_role('master_trainer')
       or public.has_role('chairperson') or public.has_role('board_member')
       or public.has_role('chief_examiner')) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  return query
  with ids as (
    select distinct upper(trim(x)) as input_id
    from unnest(_swimmer_ids) x
    where nullif(trim(x), '') is not null
  ),
  matched as (
    select i.input_id,
           c.id            as cid,
           c.swimmer_id    as sid,
           c.full_name     as fname,
           c.date_of_birth as dob,
           (select r.target_level
              from public.assessment_results r
             where r.candidate_id = c.id and r.outcome = 'pass'
             order by array_position(v_levels, r.target_level) desc
             limit 1)      as cur
    from ids i
    left join public.candidates c on c.swimmer_id = i.input_id
  ),
  withnext as (
    select m.*,
      case
        when m.cid is null then null
        when m.cur is null then 'starfish'::public.badge_level
        when array_position(v_levels, m.cur) < array_length(v_levels, 1)
          then v_levels[array_position(v_levels, m.cur) + 1]
        else null  -- already at Dolphin, no next level
      end as nxt
    from matched m
  )
  select w.input_id, (w.cid is not null), w.cid, w.sid, w.fname, w.dob, w.cur, w.nxt, f.fee_rm
  from withnext w
  left join public.fee_schedule f on f.level = w.nxt;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_weather_session(_session_id uuid, _new_date date, _keep_examiner boolean DEFAULT true, _new_venue text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.assessment_sessions%rowtype;
  v_uid      uuid := (select auth.uid());
  v_original date;
  v_keep     boolean;
begin
  select * into s from public.assessment_sessions where id = _session_id;
  if not found then
    raise exception 'session not found' using errcode = 'no_data_found';
  end if;

  -- Authority: the instructor of record (bill-to), or governance.
  if not (
        s.requested_by_profile_id = v_uid
     or public.has_role('chief_examiner')
     or public.has_role('system_admin')
     or public.has_role('chairperson')
  ) then
    raise exception 'not authorized to reschedule this session'
      using errcode = 'insufficient_privilege';
  end if;

  if s.status <> 'weather_hold' then
    raise exception 'session is % - only a session on weather hold can be rescheduled', s.status
      using errcode = 'invalid_parameter_value';
  end if;

  -- Keep the very first date across repeated rain-offs.
  v_original := coalesce(s.rescheduled_from, s.scheduled_on);

  if _new_date < current_date then
    raise exception 'new date cannot be in the past'
      using errcode = 'invalid_parameter_value';
  end if;

  -- 6-month reschedule window (decision 5). Past this, governance cancels the
  -- session (refund-due) rather than rescheduling.
  if v_original is not null and _new_date > (v_original + interval '6 months')::date then
    raise exception 'new date is beyond the 6-month reschedule window (original %); cancel for refund instead', v_original
      using errcode = 'invalid_parameter_value';
  end if;

  v_keep := _keep_examiner and s.examiner_profile_id is not null;

  update public.assessment_sessions
     set scheduled_on        = _new_date,
         venue               = coalesce(_new_venue, venue),
         rescheduled_from    = coalesce(rescheduled_from, scheduled_on),
         reschedule_count    = reschedule_count + 1,
         examiner_profile_id = case when v_keep then examiner_profile_id else null end,
         status              = case when v_keep then 'claimed' else 'open_for_pickup' end,
         updated_at          = now()
   where id = _session_id;

  insert into public.audit_log
    (actor_profile_id, action, object_type, object_id, session_id, detail)
  values
    (v_uid, 'weather_reschedule', 'session', _session_id, _session_id,
     jsonb_build_object(
       'from_date',      s.scheduled_on,
       'to_date',        _new_date,
       'original_date',  v_original,
       'kept_examiner',  v_keep,
       'new_venue',      _new_venue,
       'reschedule_count', s.reschedule_count + 1
     ));
end;
$function$;

CREATE OR REPLACE FUNCTION public.weather_hold_session(_session_id uuid, _reason text, _examiner_can_carry boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.assessment_sessions%rowtype;
  v_uid uuid := (select auth.uid());
begin
  select * into s from public.assessment_sessions where id = _session_id;
  if not found then
    raise exception 'session not found' using errcode = 'no_data_found';
  end if;

  -- Authority: the assigned examiner, or Chief Examiner / System Admin / Chairperson.
  if not (
        s.examiner_profile_id = v_uid
     or public.has_role('chief_examiner')
     or public.has_role('system_admin')
     or public.has_role('chairperson')
  ) then
    raise exception 'not authorized to declare a rain-off on this session'
      using errcode = 'insufficient_privilege';
  end if;

  -- Only a live, scheduled-and-claimed session can rain off.
  if s.status not in ('claimed', 'scheduled') then
    raise exception 'session is % - only a claimed session can be rained off', s.status
      using errcode = 'invalid_parameter_value';
  end if;

  update public.assessment_sessions
     set status              = 'weather_hold',
         weather_reason      = _reason,
         weather_hold_at     = now(),
         weather_declared_by = v_uid,
         examiner_profile_id = case when _examiner_can_carry
                                    then examiner_profile_id
                                    else null end,
         updated_at          = now()
   where id = _session_id;

  -- Rain-off is not marked. Preserve pre-stoppage absentees/no-shows and
  -- withdrawals; return anyone marked present to pending.
  update public.session_enrolments
     set attendance = 'registered',
         updated_at = now()
   where session_id = _session_id
     and attendance = 'present';

  insert into public.audit_log
    (actor_profile_id, action, object_type, object_id, session_id, detail)
  values
    (v_uid, 'weather_hold', 'session', _session_id, _session_id,
     jsonb_build_object(
       'reason',            _reason,
       'examiner_can_carry', _examiner_can_carry,
       'original_date',      s.scheduled_on,
       'examiner_released', (not _examiner_can_carry)
     ));
end;
$function$;


-- ----------------------------------------------------------------------------
-- 5. GRANTS AS DEPLOYED
--
-- Reproduced exactly as captured. EVERY function is granted to anon AND public
-- as well as authenticated. For the 20 that check has_role()/can_*() in their
-- own body that is belt-and-braces and harmless. For the three marked above it
-- is the whole of the access control, and there isn't any.
--
-- Table grants are equally wide (all privileges to anon/authenticated/
-- service_role) but RLS is enabled on every table, and centre_fee_catalog,
-- centre_invoices and centre_invoice_items carry NO policies at all, so direct
-- access is denied and everything goes through the definer RPCs.
-- ----------------------------------------------------------------------------

grant execute on function public.admin_create_account_with_password(text,text,membership_role,my_state,text) to anon, authenticated, public, service_role;
grant execute on function public.create_centre_invoice(uuid,date,date,jsonb,text) to anon, authenticated, public, service_role;
grant execute on function public.find_profile_by_email(text) to anon, authenticated, public, service_role;
grant execute on function public.fulfil_store_order(uuid,text) to anon, authenticated, public, service_role;
grant execute on function public.get_finance_settings() to anon, authenticated, public, service_role;
grant execute on function public.invite_centre_admin(uuid,text) to anon, authenticated, public, service_role;
grant execute on function public.lapse_expired_centres() to anon, authenticated, public, service_role;
grant execute on function public.list_billing_invoices() to anon, authenticated, public, service_role;
grant execute on function public.list_centre_billing() to anon, authenticated, public, service_role;
grant execute on function public.list_centre_fee_catalog() to anon, authenticated, public, service_role;
grant execute on function public.list_centres_due_renewal(integer) to anon, authenticated, public, service_role;
grant execute on function public.list_memberships() to anon, authenticated, public, service_role;
grant execute on function public.list_my_invoices() to anon, authenticated, public, service_role;
grant execute on function public.list_states() to anon, authenticated, public, service_role;
grant execute on function public.list_store_products(boolean) to anon, authenticated, public, service_role;
grant execute on function public.mark_centre_invoice_paid(uuid) to anon, authenticated, public, service_role;
grant execute on function public.mark_store_order_paid(uuid) to anon, authenticated, public, service_role;
grant execute on function public.preview_roster_swimmers(text[]) to anon, authenticated, public, service_role;
grant execute on function public.record_centre_payment(uuid,text,numeric,text,text) to anon, authenticated, public, service_role;
grant execute on function public.record_store_payment(uuid,text,numeric,text,text) to anon, authenticated, public, service_role;
grant execute on function public.reschedule_weather_session(uuid,date,boolean,text) to anon, authenticated, public, service_role;
grant execute on function public.upsert_store_product(text,text,text,numeric,text,boolean,integer) to anon, authenticated, public, service_role;
grant execute on function public.weather_hold_session(uuid,text,boolean) to anon, authenticated, public, service_role;


-- ============================================================================
-- STILL UNCAPTURED — run dump_live_schema_part8.sql, and PART 7 (whose OUTPUT
-- we never received; the script itself came back instead).
--
-- Functions (12) — four of these are the gates every captured function calls,
-- so nothing above can be applied until they are in hand:
--   can_bill_centres, can_manage_store, can_buy_store, is_store_staff*
--   next_store_order_no*            (* already in git? verify — see part8)
--   _session_reconciled, get_centre_payments, get_session_process_overview,
--   get_store_order_items, grant_centre_admin_on_signup,
--   list_my_centre_admin_overview, list_session_financial_flags,
--   log_account_event, place_store_order
--
-- Tables (3): centre_payments, centre_invitations, store_payments
-- Enums: store_order_status (and any other untracked type) — PART 7
-- Views: instructor_directory's live definition — PART 7, still the open
--        question of why it returned 0 rows
-- ============================================================================


-- ============================================================================
-- SUGGESTED REMEDIATION — NOT APPLIED. Review before running.
--
--   revoke execute on function public.get_finance_settings()      from anon, public;
--   revoke execute on function public.list_centre_fee_catalog()   from anon, public;
--   revoke execute on function public.list_store_products(boolean) from anon, public;
--
-- get_finance_settings is called from PrintableDocument.tsx, which only ever
-- renders for a signed-in user, so revoking anon should not affect the app.
-- Verify on a staging copy or watch the invoice print path after applying.
--
-- Belt-and-braces, matching the pattern the other 20 functions use, is to add
-- an explicit guard to the body as well:
--   if (select auth.uid()) is null then
--     raise exception 'not signed in' using errcode = '28000';
--   end if;
-- ============================================================================
