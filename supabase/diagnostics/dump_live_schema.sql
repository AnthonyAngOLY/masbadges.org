-- ============================================================================
-- dump_live_schema.sql — capture the live database so it can be written back
-- into supabase/migrations/.
--
-- WHY THIS EXISTS
-- Schema has repeatedly been created or edited directly in the Supabase SQL
-- editor and never committed. The frontend calls ~20 RPCs and ~6 tables that
-- have no creating migration in git, and two committed functions
-- (list_billing_invoices, list_my_invoices) are deployed with extra columns the
-- files do not have. Until this is captured, nobody can rebuild the database
-- from the repo and nobody can safely edit billing.
--
-- HOW TO RUN
-- Open the Supabase SQL editor for project `masbadges-web` and run ONE PART at
-- a time, top to bottom. The editor only shows the last result set, so do not
-- paste the whole file at once. Copy each result back verbatim.
--
-- ONE CAVEAT ON THE OUTPUT
-- User-defined types come back unqualified in PART 4 (`status
-- centre_invoice_status`, not `public.centre_invoice_status`) because
-- format_type() drops the schema when it is on the search_path. That is fine for
-- the Supabase SQL editor, but qualify them by hand when writing the migration
-- file, and put the PART 7 `create type` statements above the tables that use them.
--
-- This script is READ-ONLY. It creates nothing and changes nothing.
-- ============================================================================


-- ============================================================================
-- PART 1 — full inventory (run this first)
-- Lists every function and every table/view in `public`, so the git folder can
-- be diffed against reality rather than against a guess. Small output.
-- ============================================================================

select
  'FUNCTION' as kind,
  p.oid::regprocedure::text                                as name,
  case p.prosecdef when true then 'security definer'
                   else 'security invoker' end             as security,
  pg_get_userbyid(p.proowner)                              as owner,
  coalesce(
    (select string_agg(distinct
              case when a.grantee = 0 then 'PUBLIC'
                   else a.grantee::regrole::text end, ' ')
     from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where a.privilege_type = 'EXECUTE'
       and a.grantee is distinct from p.proowner),
    '(default)')                                           as execute_granted_to
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'

union all

select
  case c.relkind when 'r' then 'TABLE'
                 when 'v' then 'VIEW'
                 when 'm' then 'MATVIEW'
                 when 'p' then 'PARTITIONED TABLE' end,
  c.relname,
  case when c.relkind = 'r' and c.relrowsecurity then 'RLS enabled'
       when c.relkind = 'r' then 'RLS OFF'
       else '' end,
  pg_get_userbyid(c.relowner),
  coalesce(
    (select string_agg(distinct
              case when a.grantee = 0 then 'PUBLIC'
                   else a.grantee::regrole::text end, ' ')
     from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where a.grantee is distinct from c.relowner),
    '(default)')
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'v', 'm', 'p')

order by 1, 2;


-- ============================================================================
-- PART 2 — function definitions for the known-drifted RPCs
-- The `ddl` column is the exact source to paste into a migration file.
-- If PART 1 turns up more untracked functions, add their names to the array.
-- ============================================================================

select
  p.oid::regprocedure::text as signature,
  pg_get_functiondef(p.oid) as ddl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = any (array[
    -- centre-recognition billing (entirely untracked)
    'create_centre_invoice',
    'record_centre_payment',
    'mark_centre_invoice_paid',
    'list_centre_billing',
    'list_centre_fee_catalog',
    'list_centres_due_renewal',
    'lapse_expired_centres',
    -- store
    'list_store_products',
    'upsert_store_product',
    'mark_store_order_paid',
    'record_store_payment',
    'fulfil_store_order',
    -- finance / invoices
    'get_finance_settings',
    -- these two DO have migrations, but the deployed version returns extra
    -- columns (last_payment_* / session_status). Capture the live one.
    'list_billing_invoices',
    'list_my_invoices',
    -- sessions
    'preview_roster_swimmers',
    'weather_hold_session',
    'reschedule_weather_session',
    -- accounts / directory
    'admin_create_account_with_password',
    'find_profile_by_email',
    'invite_centre_admin',
    'list_memberships',
    'list_states',
    'get_my_instructor_listing',
    'set_my_instructor_listing'
  ])
order by p.proname, signature;


-- ============================================================================
-- PART 3 — EXECUTE grants for those same functions
-- A security-definer RPC is useless to the frontend without its grant, so the
-- migration has to carry these too.
-- ============================================================================

select
  'grant execute on function public.' || p.oid::regprocedure::text ||
  ' to ' || string_agg(distinct
              case when a.grantee = 0 then 'public'
                   else a.grantee::regrole::text end, ', ') || ';' as ddl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
where n.nspname = 'public'
  and a.privilege_type = 'EXECUTE'
  and a.grantee is distinct from p.proowner        -- owner grant is noise
  and p.proname = any (array[
    'create_centre_invoice','record_centre_payment','mark_centre_invoice_paid',
    'list_centre_billing','list_centre_fee_catalog','list_centres_due_renewal',
    'lapse_expired_centres','list_store_products','upsert_store_product',
    'mark_store_order_paid','record_store_payment','fulfil_store_order',
    'get_finance_settings','list_billing_invoices','list_my_invoices',
    'preview_roster_swimmers','weather_hold_session','reschedule_weather_session',
    'admin_create_account_with_password','find_profile_by_email',
    'invite_centre_admin','list_memberships','list_states',
    'get_my_instructor_listing','set_my_instructor_listing'
  ])
group by p.oid
order by 1;


-- ============================================================================
-- PART 4 — CREATE TABLE for the untracked tables
-- Reconstructed column-by-column. Constraints and indexes come in PART 5.
-- ============================================================================

with t as (
  select c.oid, c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname = any (array[
      'centre_invoices',
      'centre_invoice_items',
      'centre_fee_catalog',
      'org_finance_settings',
      'store_products',
      'store_orders',
      'store_order_items',
      'quiz_attempts'
    ])
)
select
  t.relname as table_name,
  'create table if not exists public.' || t.relname || E' (\n' ||
  string_agg(
    '  ' || quote_ident(a.attname) || ' ' ||
    format_type(a.atttypid, a.atttypmod) ||
    coalesce(' default ' || pg_get_expr(ad.adbin, ad.adrelid), '') ||
    case when a.attnotnull then ' not null' else '' end,
    E',\n' order by a.attnum
  ) || E'\n);' as ddl
from t
join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
left join pg_attrdef ad on ad.adrelid = t.oid and ad.adnum = a.attnum
group by t.relname
order by t.relname;


-- ============================================================================
-- PART 5 — constraints + indexes for those tables
-- ============================================================================

with t as (
  select c.oid, c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname = any (array[
      'centre_invoices','centre_invoice_items','centre_fee_catalog',
      'org_finance_settings','store_products','store_orders',
      'store_order_items','quiz_attempts'
    ])
)
select t.relname as table_name, 'constraint' as kind,
       'alter table public.' || t.relname ||
       ' add constraint ' || quote_ident(con.conname) || ' ' ||
       pg_get_constraintdef(con.oid) || ';' as ddl
from t join pg_constraint con on con.conrelid = t.oid

union all

select t.relname, 'index', pg_get_indexdef(i.indexrelid) || ';'
from t
join pg_index i on i.indrelid = t.oid
join pg_class ic on ic.oid = i.indexrelid
where not i.indisprimary                            -- PK arrives as a constraint
  and not exists (                                  -- and unique-constraint indexes too
    select 1 from pg_constraint c2
    where c2.conindid = i.indexrelid and c2.contype in ('u','p','x')
  )

order by 1, 2, 3;


-- ============================================================================
-- PART 6 — RLS policies and table grants for those tables
-- RLS is the real access gate here, so a migration without these is wrong.
-- ============================================================================

select
  tablename as table_name,
  'policy' as kind,
  'create policy ' || quote_ident(policyname) ||
  ' on public.' || tablename ||
  ' as ' || lower(permissive) ||
  ' for ' || lower(cmd) ||
  ' to ' || array_to_string(roles, ', ') ||
  coalesce(' using (' || qual || ')', '') ||
  coalesce(' with check (' || with_check || ')', '') || ';' as ddl
from pg_policies
where schemaname = 'public'
  and tablename = any (array[
    'centre_invoices','centre_invoice_items','centre_fee_catalog',
    'org_finance_settings','store_products','store_orders',
    'store_order_items','quiz_attempts'
  ])

union all

select
  c.relname, 'grant',
  'grant ' || string_agg(distinct lower(a.privilege_type), ', ') ||
  ' on public.' || c.relname ||
  ' to ' || case when a.grantee = 0 then 'public'
                 else a.grantee::regrole::text end || ';'
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
where n.nspname = 'public'
  and a.grantee is distinct from c.relowner        -- owner grant is noise
  and c.relname = any (array[
    'centre_invoices','centre_invoice_items','centre_fee_catalog',
    'org_finance_settings','store_products','store_orders',
    'store_order_items','quiz_attempts'
  ])
group by c.relname, a.grantee

union all

select c.relname, 'rls',
       'alter table public.' || c.relname || ' enable row level security;'
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relrowsecurity
  and c.relname = any (array[
    'centre_invoices','centre_invoice_items','centre_fee_catalog',
    'org_finance_settings','store_products','store_orders',
    'store_order_items','quiz_attempts'
  ])

order by 1, 2, 3;


-- ============================================================================
-- PART 7 — enums and view definitions
-- Untracked tables usually drag untracked enum types along with them.
-- ============================================================================

select
  'ENUM' as kind,
  t.typname as name,
  'create type public.' || t.typname || ' as enum (' ||
  string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) || ');' as ddl
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
join pg_enum e on e.enumtypid = t.oid
where n.nspname = 'public'
group by t.typname

union all

select 'VIEW', c.relname,
       'create or replace view public.' || c.relname || ' as ' ||
       pg_get_viewdef(c.oid, true)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('v', 'm')

order by 1, 2;
