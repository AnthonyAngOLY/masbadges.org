-- 20261111090000_drop_dead_store_rpcs.sql
--
-- APPLY BY HAND in the Supabase SQL editor, and ONLY after the pre-flight
-- check below comes back with nothing in section C.
--
-- Drops the first generation of the store order RPCs. They were superseded by
-- the fo_* lifecycle and have been unreachable from the application since
-- PR #101 removed the unimported pages/StoreAdmin.tsx.
--
--   place_store_order(jsonb,uuid,text,text)   superseded by submit_store_order()
--   mark_store_order_paid(uuid)               superseded by fo_mark_store_order_paid()
--   fulfil_store_order(uuid,text)             superseded by fo_ship_store_order()
--
-- They could not have worked in any case: all three write the statuses
-- 'placed' and 'fulfilled', which are not values of public.store_order_status
-- ('submitted','invoiced','paid','shipped','cancelled'). Any call raised
-- "invalid input value for enum store_order_status".
--
-- They were also granted to anon and PUBLIC, like everything else in this
-- database, so dropping them removes three anon-reachable entry points as
-- well as three dead ones.
--
-- NOT touched here, deliberately:
--   · cancel_store_order  — has two live overloads; the application uses
--     (uuid, text). Untangling the overloads is a separate job.
--   · fo_invoice_store_order / fo_mark_store_order_paid / fo_ship_store_order
--     — the live generation. Leave them alone.
--   · store_payments — mark_store_order_paid wrote to it, but
--     record_store_payment() still does, so the table stays.

-- ---------------------------------------------------------------- pre-flight
-- Run this FIRST. Section C must be empty; if any row appears there, a live
-- function still calls one of these three and the drops below must wait.
--
--   with live as (
--     select p.oid, p.oid::regprocedure::text as signature, p.proname
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname in ('place_store_order','mark_store_order_paid','fulfil_store_order')
--   ),
--   callers as (
--     select c.oid::regprocedure::text as calling_function, l.proname as calls
--     from pg_proc c join pg_namespace cn on cn.oid = c.pronamespace
--     cross join live l
--     where cn.nspname = 'public' and c.oid <> l.oid and c.prokind = 'f'
--       and c.prosrc ~ ('\m' || l.proname || '\M')
--   )
--   select 'A · live signature' as check, signature as detail from live
--   union all
--   select 'B · OVERLOAD WARNING', proname || ' has ' || count(*) || ' overloads'
--     from live group by proname having count(*) > 1
--   union all
--   select 'C · CALLED BY', calling_function || '  ->  ' || calls from callers
--   order by 1;

-- --------------------------------------------------------------------- drops
begin;

drop function if exists public.place_store_order(jsonb, uuid, text, text);
drop function if exists public.mark_store_order_paid(uuid);
drop function if exists public.fulfil_store_order(uuid, text);

-- must return 0
select count(*) as should_be_zero
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('place_store_order', 'mark_store_order_paid', 'fulfil_store_order');

commit;

-- The surviving generation must still be there: expect 3 rows.
select p.oid::regprocedure::text as still_live
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('fo_invoice_store_order', 'fo_mark_store_order_paid', 'fo_ship_store_order')
order by 1;
