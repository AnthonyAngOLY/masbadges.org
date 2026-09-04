# CLAUDE.md — MAS BADGES

Project guidance for Claude Code. This file is loaded at the start of every
session; treat it as the standing brief. Read the **actual files in the repo**
before changing them (you have direct access — never edit from assumption).

---

## What this is

**MAS BADGES** — Malaysia Aquatics' national 7-level Learn-to-Swim certification
(Starfish → Sea Turtle → Guppy → Octopus → Frog → Swordfish → Dolphin), ages 5–12.

One repo, **two surfaces**:
- **Public marketing site** (`www.masbadges.org`) — anonymous visitors.
- **Authenticated portal** (`apps.masbadges.org`) — instructors, centres, examiners, admins.

**Architectural law — producer/consumer separation.** The portal is the producer
and system of record; the public site is a consumer. They connect **only** through
one-way, read-only Postgres views/RPCs and a single "Portal login" button. There is
no cross-navigation and no shared session. Never make the public site write to, or
depend on internals of, the portal beyond the published read-only surfaces.

---

## Stack & commands

- **Frontend:** React + Vite + TypeScript.
- **Backend:** Supabase (Postgres + RLS + Auth). Security-definer functions;
  RLS is the real access gate (any role-catalog UI is documentation only).
- **Deploy:** Netlify Pro, auto-deploys on merge to `main`. Do not add deploy steps.
- **Env vars** (set in Netlify; needed for a successful build): `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_SENTRY_DSN`, `VITE_PORTAL_LOGIN_URL`.

Scripts (`package.json` — there is no test or lint script):
- Install: `npm ci` (or `npm install`)
- **Build (must pass before any PR):** `npm run build` → outputs `dist/`.
  `prebuild` runs `scripts/generate-sitemap.mjs`, which rewrites
  `public/sitemap.xml` — expect that file to change on any build.
- Dev: `npm run dev` · Preview: `npm run preview`

**Always run the build and fix type/import errors before opening a PR.** A broken
build blocks Netlify; verifying locally on the runner prevents a red deploy.

---

## How to work in this repo (Claude Code rules)

1. **Branch + PR, never push to `main`.** Create a descriptive branch
   (`feat/…`, `fix/…`, `chore/…`), commit there, and open a pull request for
   Anthony to review and merge. Merging triggers the Netlify deploy.
2. **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`),
   one logical change per commit.
3. **Read before you edit.** Open the real file; match its existing structure,
   imports, and class names. Do not invent file contents.
4. **Check for duplicates before creating a page/route.** Search `src/App.tsx`
   routes and `src/pages/` first. This repo has already shipped duplicates twice
   from pages being recreated blind (a since-removed second `/instructors`; the
   still-live `/directory` vs `/find-a-centre` pair). Reuse, don't duplicate.
5. **`src/App.tsx` is the spine** — routes, `PublicLayout` (public nav, header
   search, fixed-header scroll JS) and `AppLayout` (portal shell + role-gated
   sidebar). ~950 lines. When touching routing/nav, edit it last and re-verify
   the build.
6. **Migrations are applied by hand.** You may *write* SQL migration files
   (`supabase/…` or wherever the repo keeps them, named `YYYYMMDDHHMMSS_name.sql`),
   but **Anthony applies them in the Supabase SQL editor** — they are NOT auto-run.
   Never assume a schema change is live; note in the PR that the migration must be
   applied. The SQL editor runs as superuser (`auth.uid()` is null there), so
   role-gated functions can't be exercised in it; a `CREATE` returning no rows = ok.
   **The folder is not a faithful record of the live database** — read
   "⚠️ The migrations folder is NOT the live schema" below before any DB work.
7. **Never commit secrets** or print env values. No `.env` files in commits.
8. **Don't reformat unrelated code.** Keep diffs scoped to the task.

---

## House style

- American `-ize/-ized` spelling, but British **"centre"** (the noun) throughout.
- Brand: navy `#1E2752` / `#0a1f44`, red `#C62026`, yellow `#F9C610`,
  brand teal `#09B3CA` / deep `#0894b0`.
- Prose for parents must be plain and outcome-led; governance copy must match the
  source documents (see "Governance facts" below) — do not invent rules or fees.

---

## Repo map (orient here)

```
src/
  App.tsx        THE SPINE (~950 lines). Route table + PublicLayout (public nav,
                 header search, fixed-header scroll JS) + AppLayout (portal shell,
                 role-gated sidebar). The route table is the only authoritative
                 list of pages — read it, don't trust any list including this one.
  components/    AttentionDot · CheckpointBar · ContactForm · EditableText ·
                 ErrorBoundary · Icon · Protected · RequireRole · ScrollToTop ·
                 UpdateBanner
  lib/
    supabase.ts        Supabase client
    auth.tsx           session + hasRole() context behind Protected / RequireRole
    types.ts           MALAYSIAN_STATES, DirectoryCenter, etc.
    levels.ts          level helpers used by the portal
    contentOverrides.tsx  admin-editable copy (EditableText ↔ content_overrides)
  data/
    levels.ts      Level{level,key,name,color,badge,blurb,outcome}; LEVELS; BRAND_TEAL
    faqs.ts        FAQ_CATEGORIES (general, parents, instructors, centres, examiners)
    searchIndex.ts static index behind the header search → /search
    NOTE: guides.ts is RETIRED. Guides are DB-backed (guide_cards / guide_sections),
    read via list_public_guides(), authored at /admin/website/guides.
  styles/    theme.css 1853 lines — AUTHORITATIVE, loaded LAST (its rules win),
             covers public + portal · admin.css 760 (portal forms/lists + the
             mas-table family) · shell.css 272 (portal shell) · public.css 160
             (public base) · home.css 108 · site.css 96 · auth.css 71
  pages/     70 files. See the route table in App.tsx (~lines 865–945).
scripts/generate-sitemap.mjs   runs on `prebuild` → public/sitemap.xml
public/badges/level-1..7.png   official badge art (512px, transparent)
supabase/migrations/*.sql      119 files, applied BY HAND — and NOT a complete
                               record of the live schema (see the drift warning).
```

**Public routes:** `/` · `/the-programme` · `/for-parents` · `/for-centres` ·
`/directory` · `/find-a-centre` · `/apply-partner-centre` · `/courses` ·
`/instructors` · `/guides` + `/guides/:slug` · `/faq` · `/contact` · `/verify`
+ `/verify/:serial` · `/search` · `/privacy` · `/terms` · `/safeguarding`.

**Portal routes** (every one wrapped in `Protected` or `RequireRole` — read the
route for the exact role list; these groupings are for orientation only):

- *Everyone signed in:* `/dashboard` · `/account` · `/onboarding` · `/claim` ·
  `/parent` · `/account/resources` · `/my-application` · `/certificate/:serial`
- *Candidates & sessions:* `/candidates/register` · `/candidates/claim-slips` ·
  `/assessments/schedule` (RosterBooking) · `/my-sessions` (MySessions — holds the
  6-step session checker) · `/assessments/grade` · `/assessments/invitations` ·
  `/assessments/examiners` · `/registry/swimmers`
- *Certificates:* `/certificates` · `/certificates/issue`
- *Money IN:* `/invoices` (MyInvoices) · `/billing/payments` (BillingPayments) ·
  `/admin/centre-billing` (CentreBilling) · printables
  `/billing/invoice/:id`, `/billing/receipt/:id`
- *Money OUT:* `/billing/vouchers` (PaymentVouchers) · `/my-payouts` (MyPayouts) ·
  printable `/billing/voucher/:id`
- *Oversight:* `/admin/session-lifecycle` (SessionLifecycle — 11-checkpoint
  end-to-end view per session, money IN and OUT, read-only) · `/admin/audit-log`
- *Store:* `/store` · `/admin/store` (orders) · `/admin/store-products` (catalogue)
- *Admin:* `/centre` · `/centres/register` · `/admin/centres` ·
  `/admin/centre-directory` · `/admin/partner-applications` · `/admin/instructors` ·
  `/admin/instructor-blacklist` · `/admin/courses` · `/admin/enquiries` ·
  `/admin/memberships` · `/admin/role-registry` · `/admin/settings` ·
  `/admin/website/guides` · `/admin/website/content-overrides`
- *Unauthenticated:* `/login` · `/claim-signup` · `/auth/callback` · `/set-password`

---

## Design system

- **CSS scoping:** public under `.mas-app .mas-site`; portal under
  `.mas-app .mas-shell-main`. Add new public CSS to `theme.css` (loaded last).
- **Fonts:** body `'Nunito Sans'`; headings `'Barlow Condensed'`, uppercase.
- **CSS vars (`.mas-app`):** `--mas-navy`, `--mas-navy-light`, `--mas-paper #f5f8fc`,
  `--mas-card`, `--mas-line #e3e9f3`, `--mas-ink #0a1f44`, `--mas-muted #5d6b85`,
  `--mas-good`, `--mas-bad`, `--mas-teal #09B3CA`, `--mas-teal-deep #0894b0`,
  level palette `--lvl-1 … --lvl-7`.
- **Official level palette** (sampled from the syllabus; also in `levels.ts`):
  L1 `#FF7042` · L2 `#26A59A` · L3 `#00ACC1` · L4 `#E43834` · L5 `#66BA69` ·
  L6 `#1D87E4` · L7 `#5D34B1`.
- **Per-level theming:** set inline `style={{ ['--lvl' as string]: color }}` and
  reference `var(--lvl)` in CSS.
- **Buttons:** hero/teal `.mas-btn-solid` / `.mas-btn-outline-light`; general
  `.mas-btn-solid-navy` / `.mas-btn-ghost-navy`.
- **Shared motifs:** `.mas-cta-band` (teal + halftone), `.mas-site .mas-eyebrow::before`
  (teal tick), colour-block cards (`.mas-centre-block`, `.mas-gov-card`,
  `.mas-trust-card`, `.mas-course-card`), level pathway (`.mas-levelstrip`/`.mas-levelcard`,
  `.mas-prog-level`), FAQ accordion (`.mas-faq-*`), guides (`.mas-guide*`),
  nav dropdowns (`.mas-navitem.mas-has-menu` + `.mas-submenu`).
- **Pages that no longer import `admin.css`:** ForCentres, Courses (they use
  public classes + the navy buttons). Contact **keeps** `admin.css` (form styling).

### Header (do not regress)
The header is `position: fixed` and the content reserves a **constant** top offset
(`.mas-main { padding-top: 64px }`, 54px mobile). This is deliberate: a fixed header
out of flow can't shift content on resize, which is what eliminated a scroll
"flicker/spaz" the sticky version suffered. `PublicLayout` toggles `.is-scrolled`
with hysteresis (shrink >80px, expand <24px) + rAF throttle. **Do not return the
header to `position: sticky`** or make the content offset depend on header height.

### Nav (in `App.tsx` PublicLayout)
The programme · Find a centre ▾ (Browse the directory → `/directory`, Become a
partner centre → `/for-centres`) · Instructors · Guides ▾ (All guides + the eight
guide slugs, hard-coded in the nav even though guide bodies are DB-backed) ·
Courses · FAQ. Plus a header search (desktop expanding input + a mobile form) that
submits to `/search`, backed by `data/searchIndex.ts`.

Dropdowns open on hover/focus on desktop **and** on tap on mobile — each has a
`.mas-submenu-toggle` button driving `openSection` state (`is-open` class). Adding
a nav dropdown means adding the toggle button too; don't ship a hover-only one.
"Portal login" button → `VITE_PORTAL_LOGIN_URL ?? '/login'`.

---

## Schema — public surfaces only (the producer/consumer boundary)

The public site may read ONLY these (security-definer; minors never exposed):
- `partner_center_directory` (**view**) — recognised centres, safe columns.
- `verify_certificate(serial)` (**function**, not a view — anti-enumeration):
  serial, level, centre, issue date, valid/revoked; **never a child's name**.
- `instructor_directory` (**view**) — `profile_id, full_name, state,
  partner_center_id, centre_name`. No contact PII. **NOT opt-in as built.** The
  committed definition (`20260622290000_instructor_directory_blacklist.sql`)
  lists every active, non-blacklisted instructor with no consent filter; there is
  no `memberships.public_listing` column in any migration, and the two RPCs the
  UI calls to drive an opt-in toggle do not exist in the live database at all
  (confirmed 2026-09-04). See Known issues #2 — do not describe this as opt-in
  until it is.
- `public_courses` (**view**) — Courses page.
- `list_states()` RPC; `submit_enquiry(...)` RPC (Contact form).

**Child safety is non-negotiable:** public certificate verification must never
expose a minor's name; directories are opt-in and contain no contact PII. Don't add
public surfaces that leak candidate identity.

Roles (`membership_role` enum, in the order they were added): board_member,
coaching_panel, chairperson, chief_examiner, examiner_trainer, examiner,
instructor, partner_center_admin, system_admin, instructor_trainer,
**master_trainer**, finance_officer, finance_approver.
`has_role()` has a `system_admin` wildcard. Money out uses separation of duties:
finance_officer prepares and pays a voucher, finance_approver (or chairperson)
approves it — never the same person on both legs.
Certificates are append-only; `enforce_assessment_coi()` blocks an examiner grading
a candidate they instruct.

---

## ⚠️ The migrations folder is NOT the live schema

`supabase/migrations/` is applied by hand, and a lot of schema was created or
edited **directly in the Supabase SQL editor and never written back to git**. Treat
the folder as *partial history*, never as ground truth.

**Before touching any RPC or table, dump the live definition** and work from that:

```sql
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'the_function_name';
```

**Verified against the live database on 2026-09-04** (Part 1 of the dump script,
run against `masbadges-web`): **33 functions and 10 tables exist live with no
creating migration in git.** Rerun `node scripts/check-schema-drift.mjs` for the
subset reachable from `src/`; the full list below needs the live inventory,
because a dozen of these are only ever called from inside another function.

Untracked functions (33):
`_session_reconciled` · `admin_create_account_with_password` · `can_bill_centres` ·
`can_buy_store` · `can_manage_store` · `create_centre_invoice` ·
`find_profile_by_email` · `fulfil_store_order` · `get_centre_payments` ·
`get_finance_settings` · `get_session_process_overview` · `get_store_order_items` ·
`grant_centre_admin_on_signup` · `invite_centre_admin` · `lapse_expired_centres` ·
`list_centre_billing` · `list_centre_fee_catalog` · `list_centres_due_renewal` ·
`list_memberships` · `list_my_centre_admin_overview` ·
`list_session_financial_flags` · `list_states` · `list_store_products` ·
`log_account_event` · `mark_centre_invoice_paid` · `mark_store_order_paid` ·
`place_store_order` · `preview_roster_swimmers` · `record_centre_payment` ·
`record_store_payment` · `reschedule_weather_session` · `upsert_store_product` ·
`weather_hold_session`

Untracked tables (10): `centre_fee_catalog` · `centre_invitations` ·
`centre_invoice_items` · `centre_invoices` · `centre_payments` ·
`org_finance_settings` · `store_order_items` · `store_orders` · `store_payments` ·
`store_products`

Committed but NOT live — these migrations were applied and later undone, or never
applied at all: functions `build_session_invoice`, `record_examiner_payout`,
`record_invoice_payment`; table `assessment_fees`. Do not assume they work.

Deployed-but-different: `list_billing_invoices` and `list_my_invoices` both have
migrations, but the live versions return extra columns the files do not declare
(`last_payment_*` and `session_status`). Never regenerate them from the files.

Called by the frontend but **absent from the live database entirely**:
`get_my_instructor_listing`, `set_my_instructor_listing` (see Known issues #2).

`supabase/migrations/README.md`'s "Applied so far" table stops at 6 files out of
119 — ignore it.

### Three separate money subsystems (do not wire across them)

Each has its OWN payments table. Confirmed live 2026-09-04:

1. **Assessment billing** — `invoices` / `invoice_items` / **`payments`** /
   `receipts` / `invoice_counter` / `receipt_counter`, driven by assessment
   sessions. Money IN from instructors/centres. The only one fully in git.
2. **Centre-recognition billing** — `centre_invoices` / `centre_invoice_items` /
   **`centre_payments`** / `centre_fee_catalog` / `centre_invitations`, the
   untracked RPCs above, `CentreBilling.tsx`. Annual recognition fees. Entirely
   untracked — every table and function created in the SQL editor.
3. **Store orders** — `store_orders` / `store_order_items` / **`store_payments`** /
   `store_products`, `next_store_order_no()`. Also entirely untracked.

So `record_payment`, `record_centre_payment` and `record_store_payment` write to
three different tables. Reading one and assuming the others match is how you
produce a total that is wrong and looks right.

They look alike and are not. A change in one does not belong in another.

`payments.direction` is `'inbound'` | `'payout'` — **there is no `'outbound'`**.
A refund is `direction = 'payout'` with `note = 'refund'` (no separate table).

The shipped `/admin/session-lifecycle` page defines "money due out" as **raised
vouchers only** — not amounts expected from `payout_schedule`.

---

## Known issues / next tasks

1. **Schema drift** (see the warning above) — the highest-risk item. Verified
   2026-09-04: **33 functions and 10 tables** exist only in the live database.
   Capture them into migration files from `pg_get_functiondef` output using
   `supabase/diagnostics/dump_live_schema.sql`.
2. **The instructor opt-in toggle is broken in production.** `AccountSettings.tsx`
   (lines 43, 59) calls `get_my_instructor_listing()` and
   `set_my_instructor_listing(_on)`; neither function exists in the live database.
   The read discards its error, so the switch renders **off for every instructor**
   regardless of reality; clicking it surfaces a raw PostgREST "function not found"
   error. Worse, the shipped view has no consent filter, so `/instructors` may be
   publishing every active instructor's name, state and centre without opt-in.
   Fix needs a migration (add the consent column, gate the view, create both
   RPCs) — check the live view definition first, it may already differ.
3. **Two live public centre directories.** `/directory` (`Directory.tsx`, reads the
   `partner_center_directory` view, 175 lines) and `/find-a-centre`
   (`PublicCentreDirectory.tsx`, reads `list_published_centres()`, richer: hero
   images, classification badges, expandable cards, 389 lines). The nav points at
   `/directory`; `/find-a-centre` is reachable only by URL. Decide which survives,
   then remove the other route, page and nav entry.
4. **L7 Dolphin badge** has a faint purple rim (cut from a purple PDF panel; the
   artwork sheet only has L1–L6). Re-cut cleanly only if the original Dolphin
   artwork file is added to the repo.
5. **`PublicCentreDirectory.tsx` styles itself from an inline `STYLES` constant**
   instead of `theme.css`. If the page survives item 2, fold its CSS into
   `theme.css` like every other page.
6. **Deferred (portal):** online card payment (provider TBD), PDF/QR hardcopy
   certs, calendar module, real Storage upload for payment proofs.

**Resolved — do not "fix" these again:** the duplicate `/instructors` route (gone;
only `Instructors.tsx` remains) and hover-only mobile nav dropdowns (tap-to-expand
shipped). The instructor opt-in toggle is **not** resolved despite the UI being
wired — see Known issues #2.

---

## Governance facts (use these; do not invent)

Seven levels in order, no skipping. Every assessment booking is by/under a
certified instructor (no anonymous centre booking). Independent-examiner firewall:
an examiner never assesses their own student (enforced in data). Pass/Refer only —
no partial pass; a Refer can be re-attempted anytime, no limit. Results are released
on the portal, not poolside. Assessment is practical only (no theory quiz).
Certificate issued within 7 working days (~2–3 weeks to badge in hand). Parents
claim a child via a one-time claim slip/code (never printed on a certificate) →
create account → enter code → view levels/certificates. National fees: RM50 (L1–3),
RM75 (L4–7). Centres need a certified instructor at all times, file an annual
return, give 14-day notice of material changes, and from 2027 must assess ≥50
candidates/year; a centre may host non-partner swimmers for a venue fee.
Examiner pathway: instructor cert + 2yr teaching + lifesaving + good standing →
apply → 2–3 day course → 80% theory + portal + practical + pilot (10 candidates / 3
levels in 6 months) → Coaching Panel ratifies → role + UID (2-year term).

## House UI law — dense tables (NON-NEGOTIABLE)

Every list of records in the portal is a **dense data table**. Card-stacks for
data are prohibited. This applies to ALL modules, existing and new.

**Rules:**
1. **Dense table, not cards.** One row per record, tight vertical padding, a
   sticky-header navy `#1E2752` table (reuse the `mas-table` family in `admin.css`).
   Expandable detail rows for per-record actions/detail. Never a stack of tall cards.
2. **Inline add, not a form card.** "Create / New" is an inline **+ add row** at the
   top of the table — fill the fields in a row and save — not a separate tall form
   card above the list. (Long multi-field creates may use a single expanding add-row.)
3. **Active / inactive tabs + per-row archive control.** Every table has two tabs:
   the active set and the "inactive" set, plus a per-row control to move a record
   between them. The *meaning* of "inactive" is per data type (see mapping) — do not
   bolt a generic `archived` flag onto a table that already expresses inactivity.

**Archive/inactive mapping (use the existing status; invent `archived_at` only where none exists):**
- Candidates → Active / **Archived** (NEW `archived_at`)
- Courses → Active / **Archived** (NEW `archived_at`)
- Certificates → Valid / **Revoked** (existing revoke)
- Examiner registry → Active / **Revoked** (existing)
- Memberships → Active / **Expired** (existing `expires_at`)
- Products / Store → Active / **Hidden** (existing hide)
- Invoices → Outstanding / Paid / **Void** (existing status)
- Payment vouchers → Active (draft + approved) / Paid / **Void** (existing `status`)
- Instructor blacklist → Active / **Lifted**
- Sessions → Active / Completed / Cancelled / **Archived** (existing `session_status`)

New screens MUST be built to this law from the start. Do not ship a card-stack list
and defer conversion.
