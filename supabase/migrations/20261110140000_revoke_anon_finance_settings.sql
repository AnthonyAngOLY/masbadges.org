-- 20261110140000_revoke_anon_finance_settings.sql
--
-- Stops anonymous visitors reading the organisation's bank details.
--
-- THE PROBLEM, as captured from the live database on 2026-11-10:
--
--   get_finance_settings() is SECURITY DEFINER, so it bypasses RLS. Its body
--   performs NO authorisation check of any kind. And it is granted EXECUTE to
--   anon — the publishable key shipped inside the public frontend bundle.
--
--   It returns beneficiary_name, bank_name, bank_address, account_myr,
--   account_usd, swift_code, finance_email, finance_pic and pay_note.
--
--   org_finance_settings' own RLS policy (ofs_select) restricts SELECT to
--   auth.uid() IS NOT NULL. So the table says "signed in only" and the
--   function hands the same rows to anyone. The function is a hole around its
--   own table's rule.
--
--   Exposure: anyone who opens www.masbadges.org can read the account numbers
--   and the finance contact, which is the raw material for a spoofed invoice
--   sent to a partner centre.
--
-- TWO LESSER CASES, same shape, much lower stakes:
--   list_centre_fee_catalog()  — the centre fee schedule
--   list_store_products()      — the store catalogue and its prices
--
-- WHY REVOKING IS SAFE: each of these three is called from exactly one screen,
-- and all three screens sit behind RequireRole, so every real caller is
-- authenticated. Checked 2026-11-10:
--   get_finance_settings      → PrintableDocument.tsx  (/billing/invoice/:id,
--                                /billing/receipt/:id)
--   list_centre_fee_catalog   → CentreBilling.tsx      (/admin/centre-billing)
--   list_store_products       → StoreAdmin.tsx         (/admin/store)
-- The public Store page reads the store_products TABLE directly rather than
-- this RPC, and that table's own RLS is unchanged here, so the shop is
-- unaffected.
--
-- `authenticated` and `service_role` hold their own explicit grants, so
-- revoking from anon and PUBLIC leaves both working.

revoke execute on function public.get_finance_settings()       from anon, public;
revoke execute on function public.list_centre_fee_catalog()    from anon, public;
revoke execute on function public.list_store_products(boolean) from anon, public;


-- Defence in depth for the one that matters. A grant can be handed back by
-- accident — and was, since every function in this database is granted to anon
-- — so put the check in the body too, where it cannot be undone by a GRANT.
--
-- Written as a WHERE predicate rather than a RAISE so the function keeps its
-- signature, its LANGUAGE sql and its STABLE marking. An anonymous caller gets
-- zero rows instead of the bank details; a signed-in caller is unaffected.
-- Everything else is reproduced exactly as deployed, search_path pin included.
create or replace function public.get_finance_settings()
returns table(beneficiary_name text, bank_name text, bank_address text,
              account_myr text, account_usd text, swift_code text,
              finance_email text, finance_pic text, pay_note text)
language sql
stable
security definer
set search_path to ''
as $function$
  select beneficiary_name, bank_name, bank_address, account_myr, account_usd,
         swift_code, finance_email, finance_pic, pay_note
  from public.org_finance_settings
  where id = 'default'
    and (select auth.uid()) is not null;
$function$;

grant execute on function public.get_finance_settings() to authenticated, service_role;
