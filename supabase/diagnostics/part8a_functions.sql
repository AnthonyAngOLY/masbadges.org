-- MAS BADGES — live schema capture, PART 8a: the 11 functions still missing
-- Project: masbadges-web (agotjhsyoihwdouapcvw).
--
-- Completes the capture. The arrays in dump_live_schema.sql were written
-- before the PART 1 inventory existed and never widened, so these 11 objects
-- were missed. Everything already captured depends on them, which is why
-- captured_live_schema_2026-11-10.sql cannot be promoted to migrations yet.
--
-- READ-ONLY. One SELECT, one result set. Run it and send the grid back.

select
  p.oid::regprocedure::text as signature,
  pg_get_functiondef(p.oid) as ddl,
  coalesce(
    (select string_agg(distinct
              case when a.grantee = 0 then 'public' else a.grantee::regrole::text end, ', ')
     from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where a.privilege_type = 'EXECUTE'
       and a.grantee is distinct from p.proowner),
    '(default)')            as execute_granted_to
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = any (array[
    '_session_reconciled',
    'can_buy_store',
    'can_manage_store',
    'get_centre_payments',
    'get_session_process_overview',
    'get_store_order_items',
    'grant_centre_admin_on_signup',
    'list_my_centre_admin_overview',
    'list_session_financial_flags',
    'log_account_event',
    'place_store_order'
  ])
order by p.proname, signature;
