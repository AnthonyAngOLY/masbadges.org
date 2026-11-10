-- MAS BADGES — live schema capture, PART 8b: the 3 tables still missing
-- Project: masbadges-web (agotjhsyoihwdouapcvw).
--
-- Completes the capture. The arrays in dump_live_schema.sql were written
-- before the PART 1 inventory existed and never widened, so these 3 objects
-- were missed. Everything already captured depends on them, which is why
-- captured_live_schema_2026-11-10.sql cannot be promoted to migrations yet.
--
-- READ-ONLY. One SELECT, one result set. Run it and send the grid back.

with t as (
  select c.oid, c.relname, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname = any (array['centre_payments',
    'centre_invitations',
    'store_payments'])
)
select t.relname as table_name, '1_columns' as kind,
       'create table if not exists public.' || t.relname || E' (\n' ||
       string_agg('  ' || quote_ident(a.attname) || ' ' ||
         format_type(a.atttypid, a.atttypmod) ||
         coalesce(' default ' || pg_get_expr(ad.adbin, ad.adrelid), '') ||
         case when a.attnotnull then ' not null' else '' end,
         E',\n' order by a.attnum) || E'\n);' as ddl
from t
join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
left join pg_attrdef ad on ad.adrelid = t.oid and ad.adnum = a.attnum
group by t.relname

union all
select t.relname, '2_constraint',
       'alter table public.' || t.relname || ' add constraint ' ||
       quote_ident(con.conname) || ' ' || pg_get_constraintdef(con.oid) || ';'
from t join pg_constraint con on con.conrelid = t.oid

union all
select t.relname, '3_index', pg_get_indexdef(i.indexrelid) || ';'
from t
join pg_index i on i.indrelid = t.oid
where not i.indisprimary
  and not exists (select 1 from pg_constraint c2
                  where c2.conindid = i.indexrelid and c2.contype in ('u','p','x'))

union all
select t.relname, '4_rls', 'alter table public.' || t.relname || ' enable row level security;'
from t where t.relrowsecurity

union all
select pol.tablename, '5_policy',
       'create policy ' || quote_ident(pol.policyname) || ' on public.' || pol.tablename ||
       ' as ' || lower(pol.permissive) || ' for ' || lower(pol.cmd) ||
       ' to ' || array_to_string(pol.roles, ', ') ||
       coalesce(' using (' || pol.qual || ')', '') ||
       coalesce(' with check (' || pol.with_check || ')', '') || ';'
from pg_policies pol
where pol.schemaname = 'public' and pol.tablename = any (array['centre_payments',
    'centre_invitations',
    'store_payments'])

union all
select t.relname, '6_grant',
       'grant ' || string_agg(distinct lower(a.privilege_type), ', ') ||
       ' on public.' || t.relname || ' to ' ||
       case when a.grantee = 0 then 'public' else a.grantee::regrole::text end || ';'
from t
cross join lateral aclexplode(coalesce(
  (select relacl from pg_class where oid = t.oid),
  acldefault('r', (select relowner from pg_class where oid = t.oid)))) a
where a.grantee is distinct from (select relowner from pg_class where oid = t.oid)
group by t.relname, a.grantee

order by 1, 2, 3;
