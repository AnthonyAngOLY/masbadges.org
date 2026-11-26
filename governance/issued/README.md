# Issued documents — the authoritative set

**These PDFs are the baseline. From 2026-11-26 onwards they are what MAS BADGES
says, and every new edition lands here.**

They are the designed, issued editions. The `.docx` and `.md` files in
`governance/` are the earlier working drafts they were built from — those drafts
were taken out to a design tool, **edited there**, and returned as these PDFs. So
where a draft and an issued PDF disagree, **the PDF is right and the draft is
stale**. Do not quote a `.docx` for anything that ships.

---

## Document numbering

Each document carries a number in its filename. Numbers are per document, with a
suffix when a document comes in parts.

| Pattern | Meaning | Example |
|---|---|---|
| `NNN` | A document with no parts | `003_BADGES_TEACHING_SYSTEM_HANDBOOK` |
| `NNN-1` | **Part 1a** — the Guide (the course) | `002-1_BADGES_EXAMINER_COURSE_GUIDE` |
| `NNN-2` | **Part 1b** — the Booklet (the participant workbook) | `002-2_BADGES_EXAMINER_COURSE_BOOKLET` |
| `NNN-F` | The Forms pack for that document | `002-F_BADGES_EXAMINER_FORMS` |

**The 1a / 1b rule.** Where a document is issued as a pair — a Guide and its
Notes Booklet — the two are **Version 1a and Version 1b of one document**, not
two documents. They are versioned together and reissued together. The Guide
carries the version block on its cover; the Booklet inherits it.

**Forms are versioned individually.** A Forms pack is a container. Each form
inside it has its own ID and its own version (`F-EXM-01 · V1.0`), and one form
can be reissued without reissuing the pack.

---

## In force

| № | Document | Version | Branch | Custodian / delivery |
|---|---|---|---|---|
| **002-1** | Examiner Certification Course Guide *(1a)* | **1.0 · 3 July 2026** | Examiner / Assessment | Delivered by the Master Trainer, with the Chief Examiner |
| **002-2** | Examiner Notes Booklet *(1b)* | inherits 002-1 | Examiner / Assessment | Participant workbook |
| **002-F** | Examiner Forms | per form — see below | Examiner / Assessment | Held by the Master Trainer |
| **003** | Teaching System Handbook | **1.0 · 2 July 2026** | Instructor / Teaching | Coaching & Technical Board + Master Trainer |

### Forms inside 002-F

| Form | Title | Version |
|---|---|---|
| `F-EXM-01` | Examiner Code of Conduct — signed instrument | 1.0 |
| `F-EXM-02` | Candidate Examiner Particulars & Intake Register | 1.0 |
| `F-EXM-03` | Candidate Examiner Certification Checklist | 1.0 |
| `F-EXM-04` | M9 Group Mock Session Plan | referenced by the Guide |
| `F-EXM-05` / `F-EXM-06` | Poolside Calibration Sheets | referenced by the Guide |
| `F-SHR-03` | Good Standing & Safeguarding Declaration | referenced by the Guide (shared form) |

---

## The full family — what is still to come

The back cover of 002-1 names eight documents. Four are issued; **four are not
here yet**:

| № | Document | Issued? |
|---|---|---|
| — | System Manual — the root | ⬜ awaited |
| — | 7-Level Syllabus | ⬜ awaited |
| **003** | Teaching System Handbook | ✅ |
| — | Instructor Course Guide *(1a)* | ⬜ awaited |
| — | Instructor Notes Booklet *(1b)* | ⬜ awaited |
| — | Assessment System Handbook | ⬜ awaited |
| **002-1** | Examiner Course Guide *(1a)* | ✅ |
| **002-2** | Examiner Notes Booklet *(1b)* | ✅ |

The numbering suggests `001` is the Instructor Course pair and `002` the Examiner
Course pair; the Manual, Syllabus and the two Handbooks have numbers not yet
seen. Confirm the scheme when the rest arrive rather than guessing it.

---

## Design conventions observed in the issued set

Recorded so a future edition matches rather than drifts:

- **The branch sets the colour.** Instructor / Teaching documents are **green**;
  Examiner / Assessment documents are **blue**. The cover, section numerals and
  rules all take the branch colour.
- Every cover carries the MAS mark, `MALAYSIA AQUATICS · AKUATIK MALAYSIA`, a
  branch chip, the title, a one-line description, and a version block.
- Every cover ends with a **"Where this sits in the family"** panel placing the
  document among its siblings.
- Running footers read `MAS BADGES · <DOCUMENT TITLE>` with a two-digit page
  number.
- Sections are numbered in a filled rounded square beside an uppercase eyebrow
  and a display heading.
- The Guide closes on a full-bleed back cover carrying the whole family as chips,
  with the current document highlighted.

---

## Adding a new edition

1. Drop the PDF in `governance/issued/`, named for its number — keep the existing
   pattern exactly, including the `-1` / `-2` / `-F` suffix.
2. Move the edition it replaces to `governance/issued/superseded/`.
3. Add or update its row above, with the version **as printed on its cover**, not
   as inferred from the filename.
4. If it changes a rule the portal enforces, open an issue against the portal in
   the same breath — see the dependency table in `governance/README.md`.

Git is the revision history. Never keep `_final` or `_v2` copies.
