-- MAS BADGES — live schema capture, PART 8c: enums and view definitions
-- Project: masbadges-web (agotjhsyoihwdouapcvw).
--
-- Completes the capture. The arrays in dump_live_schema.sql were written
-- before the PART 1 inventory existed and never widened, so the enums and views were missed. Everything already captured depends on them, which is why
-- captured_live_schema_2026-11-10.sql cannot be promoted to migrations yet.
--
-- READ-ONLY. One SELECT, one result set. Run it and send the grid back.

-- This is PART 7 re-sent: its output never came back, so store_order_status
-- (which public.store_orders depends on) and the live view definitions are
-- still unrecorded.

select 'ENUM' as kind, t.typname as name,
  'create type public.' || t.typname || ' as enum (' ||
  string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) || ');' as ddl
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
join pg_enum e on e.enumtypid = t.oid
where n.nspname = 'public'
group by t.typname

union all

select 'VIEW', c.relname,
       'create or replace view public.' || c.relname || ' as ' || pg_get_viewdef(c.oid, true)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('v','m')

order by 1, 2;
