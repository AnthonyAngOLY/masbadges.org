-- 20261113090000_rls_on_counter_tables.sql
--
-- APPLY BY HAND in the Supabase SQL editor. Run the scan in step 1 first — it
-- names every table this applies to, and may name tables this file does not
-- cover (the migrations folder is not the live schema).
--
-- Supabase Security Advisor raised rls_disabled_in_public on masbadges-web.
--
-- invoice_counter and receipt_counter were created in June 2026 with no RLS
-- and no policy. Like every table in this database they are granted to anon,
-- so with RLS off the anon key — which ships in the public bundle — could
-- read AND WRITE them. Moving a counter backwards hands the next assessment
-- invoice or receipt a serial that is already in use.
--
-- voucher_counter, created two months later, got this treatment at birth:
-- RLS on, one deny-all policy, allocation only through a definer function.
-- This brings the two older counters up to that standard. Nothing in src/
-- touches either table; both are written only from inside SECURITY DEFINER
-- functions, which run as the table owner and so bypass RLS.
--
-- Verified on PostgreSQL 16: as anon, a SECURITY DEFINER allocator still
-- increments the counter (41 -> 42) while a direct `select` returns 0 rows.

-- ------------------------------------------------- step 1 · scan (run first)
-- Lists every table in public with RLS off, worst first. Expect the two
-- counters below. Anything else it names needs its own decision before you
-- run step 2 — do not assume this file covers it.
--
--   select
--     c.relname as table_name,
--     case
--       when has_table_privilege('anon', c.oid, 'SELECT') then 'EXPOSED - anon can read'
--       when has_table_privilege('authenticated', c.oid, 'SELECT') then 'signed-in users can read'
--       else 'no API grant - low risk'
--     end as severity,
--     array_to_string(array_remove(array[
--       case when has_table_privilege('anon', c.oid, 'SELECT') then 'select' end,
--       case when has_table_privilege('anon', c.oid, 'INSERT') then 'insert' end,
--       case when has_table_privilege('anon', c.oid, 'UPDATE') then 'update' end,
--       case when has_table_privilege('anon', c.oid, 'DELETE') then 'delete' end
--     ], null), ', ') as anon_can,
--     (select count(*) from pg_policies p
--       where p.schemaname = 'public' and p.tablename = c.relname) as policies
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
--   order by 2, 1;

-- ------------------------------------------------------------ step 2 · fix
begin;

alter table public.invoice_counter enable row level security;
drop policy if exists invoice_counter_no_direct_access on public.invoice_counter;
create policy invoice_counter_no_direct_access on public.invoice_counter
  for all using (false) with check (false);

alter table public.receipt_counter enable row level security;
drop policy if exists receipt_counter_no_direct_access on public.receipt_counter;
create policy receipt_counter_no_direct_access on public.receipt_counter
  for all using (false) with check (false);

commit;

-- ------------------------------------------------------- step 3 · confirm
-- Expect 3 rows, all reading 'on' with 1 policy each.
select c.relname as counter_table,
       case when c.relrowsecurity then 'on' else 'OFF' end as rls,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('invoice_counter', 'receipt_counter', 'voucher_counter')
order by 1;
