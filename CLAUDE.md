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

Check `package.json` for exact scripts. Typical:
- Install: `npm ci` (or `npm install`)
- **Build (must pass before any PR):** `npm run build` → outputs `dist/`
- Dev: `npm run dev`

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
   routes and `src/pages/` first — this repo already shipped a duplicate
   `/instructors` route from a page being recreated blind. Reuse, don't duplicate.
5. **`src/App.tsx` is the spine** (routes + `PublicLayout` + nav + scroll JS).
   When touching routing/nav, edit it last and re-verify the build.
6. **Migrations are applied by hand.** You may *write* SQL migration files
   (`supabase/…` or wherever the repo keeps them, named `YYYYMMDDHHMMSS_name.sql`),
   but **Anthony applies them in the Supabase SQL editor** — they are NOT auto-run.
   Never assume a schema change is live; note in the PR that the migration must be
   applied. The SQL editor runs as superuser (`auth.uid()` is null there), so
   role-gated functions can't be exercised in it; a `CREATE` returning no rows = ok.
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
  App.tsx              routes + PublicLayout (nav, fixed-header scroll JS). Spine.
  lib/supabase.ts      Supabase client
  lib/types.ts         MALAYSIAN_STATES, DirectoryCenter, etc.
  styles/
    theme.css          ~1340 lines, AUTHORITATIVE, loaded LAST (its rules win). Public + portal.
    public.css         public base (fonts, .mas-page, .mas-main, .mas-topnav base)
    admin.css          portal forms/lists
    shell.css          portal shell
  data/
    levels.ts          Level{level,key,name,color,badge,blurb,outcome}; LEVELS; BRAND_TEAL
    faqs.ts            FAQ_CATEGORIES (order: general,parents,instructors,centres,examiners)
    guides.ts          GUIDES (8 narrative guides)
  pages/   PUBLIC: Home, TheProgramme (/the-programme), Directory (/directory),
           ForCentres (/for-centres), ForParents (/for-parents), Courses (/courses),
           Contact (/contact), FAQ (/faq), Guides (/guides),
           GuideDetail (/guides/:slug), Instructors (/instructors),
           InstructorDirectory (DUPLICATE /instructors — see Known issues),
           Verify (/verify, /verify/:serial), Privacy, Terms, Safeguarding
           PORTAL (role-gated): Dashboard, AccountSettings (/account), ClaimCandidate,
           MyInvoices, CentreAdmin, RegisterCandidate, ClaimSlips, CreateSession,
           InviteExaminer, ExaminerGrading, Invitations, AssessmentsOversight,
           PaymentVouchers (/billing/vouchers — money OUT),
           MyPayouts (/my-payouts — payee's own approved/paid vouchers),
           SessionLifecycle (/admin/session-lifecycle — 11-checkpoint end-to-end
             process overview per session, incl. money IN and OUT; read-only),
           ExaminerRegistry, Certificates, Accounts, CentreBilling, Store, StoreAdmin,
           InstructorOnboarding, InstructorBlacklist, CourseManagement,
           CentreManagement, Enquiries, RegisterCentre, PartnerApplications,
           RoleRegistry, MembershipManagement, Login, Signup
public/badges/level-1..7.png   official badge art (512px, transparent)
```

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
The programme · Find a centre ▾ (Browse directory, Become a partner centre) ·
Instructors · Guides ▾ (All guides + each guide) · Courses · FAQ.
Pure-CSS hover/focus dropdowns; collapse to parent links on mobile (hover-only —
a known limitation). "Portal login" button → `VITE_PORTAL_LOGIN_URL ?? '/login'`.

---

## Schema — public surfaces only (the producer/consumer boundary)

The public site may read ONLY these (security-definer; minors never exposed):
- `partner_center_directory` (**view**) — recognised centres, safe columns.
- `verify_certificate(serial)` (**function**, not a view — anti-enumeration):
  serial, level, centre, issue date, valid/revoked; **never a child's name**.
- `instructor_directory` (**view**) — **opt-in**; `full_name, state, centre_name,
  independent`. No contact PII. Backed by `memberships.public_listing` +
  `set_my_instructor_listing(bool)` / `get_my_instructor_listing()`.
- `public_courses` (**view**) — Courses page.
- `list_states()` RPC; `submit_enquiry(...)` RPC (Contact form).

**Child safety is non-negotiable:** public certificate verification must never
expose a minor's name; directories are opt-in and contain no contact PII. Don't add
public surfaces that leak candidate identity.

Roles (`membership_role` enum): board_member, coaching_panel, chairperson,
chief_examiner, examiner_trainer, examiner, instructor, partner_center_admin,
system_admin, instructor_trainer, finance_officer, finance_approver.
`has_role()` has a `system_admin` wildcard. Money out uses separation of duties:
finance_officer prepares and pays a voucher, finance_approver (or chairperson)
approves it — never the same person on both legs.
Certificates are append-only; `enforce_assessment_coi()` blocks an examiner grading
a candidate they instruct.

---

## Known issues / next tasks

1. **Duplicate `/instructors` route** in `App.tsx`: both `Instructors` (reads the
   opt-in `instructor_directory` view) and a pre-existing `InstructorDirectory`.
   Decide which to keep, remove the other route + import. Read both pages first.
2. **Instructor opt-in toggle** not wired to UI. Add a labelled switch on
   `AccountSettings` (`/account`): initialise from `get_my_instructor_listing()`,
   write via `set_my_instructor_listing(_on)`. Directory is empty until instructors
   opt in (correct default).
3. **L7 Dolphin badge** has a faint purple rim (cut from a purple PDF panel; the
   artwork sheet only has L1–L6). Re-cut cleanly only if the original Dolphin
   artwork file is added to the repo.
4. **Mobile nav dropdowns** are hover-only. Optional: add tap-to-expand JS.
5. **Deferred (portal):** online card payment (provider TBD), PDF/QR hardcopy
   certs, calendar module, real Storage upload for payment proofs.

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
