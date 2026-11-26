# MAS BADGES — Governance document register

The source of record for the programme's governing documents. Everything in
`CLAUDE.md`'s "Governance facts" section is a **summary** of these files — when
the two disagree, these win, and `CLAUDE.md` should be corrected.

> ## ⚠️ Read `issued/` first — it is the baseline
>
> **`governance/issued/` holds the designed, issued PDFs. From 2026-11-26 those
> are authoritative.** The `.docx` and `.md` files in this folder are the working
> drafts they were built from; the drafts were taken out to a design tool,
> **edited there**, and returned as PDFs. Where a draft and an issued PDF
> disagree, **the PDF is right and the draft is stale**.
>
> Four of the eight documents are issued so far (`002-1`, `002-2`, `002-F`,
> `003`). The rest are still represented only by drafts here. See
> `governance/issued/README.md` for the numbering scheme, the 1a / 1b rule for
> paired documents, and what is still awaited.

**Audit date: 2026-11-26.** Editions below are what each document declares in its
own header, read from the file, not inferred from its filename.

---

## Filing rules

1. **Current editions live in `governance/`. Superseded editions move to
   `governance/archive/`.** The folder a file sits in is a claim about whether it
   is in force.
2. **The edition goes in the filename**, matching the edition the document
   declares inside itself: `MAS_BADGES_<Document>_Edition_2_4.docx`. If the two
   disagree, the document is wrong until someone says otherwise — see the Manual
   discrepancy below.
3. **Every document keeps a `.md` twin.** The `.docx` or `.pdf` is what you send
   people; the `.md` is what makes the document greppable, diffable and reviewable
   in a pull request. Generate it with
   `pandoc -f docx -t markdown --wrap=none <file>.docx -o <file>.md`.
4. **Update this register in the same commit** that adds or supersedes a document.
   A file added without a row here is invisible.
5. **Git is the revision history.** Never keep `_final`, `_v2`, `_FINAL` copies —
   `git log --follow <file>` is the audit trail, and it is better than any naming
   scheme.

### Adding a new document or edition

```
# 1. drop the file in, named for the edition it declares
# 2. generate the .md twin
pandoc -f docx -t markdown --wrap=none governance/NEW_DOC.docx -o governance/NEW_DOC.md
# 3. move the edition it supersedes
git mv governance/OLD_DOC.* governance/archive/
# 4. add its row to this register, then commit all of it together
```

---

## Working drafts (superseded where an issued PDF exists)

An **Issued** row below means `governance/issued/` carries the authoritative
version and the draft here is historical. Do not quote a superseded draft.

| Document | Declares | Files | Custodian |
|---|---|---|---|
| **BADGES System Manual** | `Edition 2.3 · 7 July 2026` ⚠️ **see discrepancy** | `MAS_BADGES_Manual_Edition_2_4` · `.docx` `.pdf` `.md` | BADGES Chairperson; technical clauses co-owned by the Coaching Panel |
| **7-Level Syllabus** | `Version 1.0` | `MAS_BADGES_7_Level_Syllabus` · `.docx` `.md` | MAS Coaching & Technical Board |
| **Assessment System Handbook** | `Version 1.0` | `MAS_BADGES_Assessment_System_Handbook` · `.docx` `.md` | Chief Examiner |
| **Teaching System Handbook** ⬅ **ISSUED as `003`** | `Version 1.0` | draft: `MAS_BADGES_Teaching_System_Handbook` · `.docx` `.md` | Coaching & Technical Board + Master Trainer |
| **Instructor Certification Course Guide** | `Version 1.0` | `MAS_BADGES_Instructor_Certification_Course_Guide` · `.docx` `.md` | Coaching & Technical Board |
| **Instructor Certification Course Notes Booklet** | *no version declared* | `MAS_BADGES_Instructor_Certification_Course_Notes_Booklet` · `.docx` `.md` | — |
| **Examiner Certification Course Guide** ⬅ **ISSUED as `002-1`** | `Version 1.0` | draft: `MAS_BADGES_Examiner_Certification_Course_Guide` · `.docx` `.md` | Delivered by Master Trainer, with the Chief Examiner |
| **Examiner Certification Course Notes Booklet** ⬅ **ISSUED as `002-2`** | *draft declared none; issued as Version 1b of `002-1`* | draft: `MAS_BADGES_Examiner_Certification_Course_Notes_Booklet` · `.docx` `.md` | — |

### Not a governance document

| File | What it is |
|---|---|
| `Assessment_Workflow_Redesign_Spec.md` | An internal engineering spec, not a governing document. Kept here for proximity; it governs nothing. |

---

## ⚠️ Unresolved: which Manual edition is in force

Two files both declare **Edition 2.3**, and their content differs:

| File | Declares | Size |
|---|---|---|
| `MAS_BADGES_Manual_Edition_2_3.md` / `.docx` | Edition 2.3 | 45 KB |
| `MAS_BADGES_Manual_Edition_2_4.docx` / `.pdf` | **Edition 2.3 · 7 July 2026**, "Supersedes Edition 2.2" | 59 KB |

The `2_4` file is the larger and presumably later one, but **its header was never
bumped from 2.3**, so the filename and the document disagree. Until someone
confirms which is in force:

- `2_4` is treated as current here because it is the later and fuller text, and
  it is the only Manual with a PDF.
- `2_3` and `2_1` are **superseded but still sitting in `governance/`** rather
  than `archive/`, because moving them would assert an answer to this question.

**To resolve:** confirm whether the `2_4` file is Edition 2.4, correct its header
line, then `git mv` the `2_1` and `2_3` files into `archive/` and update this
register. Edition 2.0 is already archived.

---

## Superseded (`archive/`)

| Document | Declares |
|---|---|
| BADGES Manual | `Edition 2.0` |
| 7-Level Syllabus (earlier) | `Edition 2.0` — note the numbering differs from the current `Version 1.0`; the two documents number themselves on different schemes |
| Assessment System Handbook (reconciled) | `Edition 1.1` |
| Teaching System Handbook | `Edition 1.0` |
| Examiner Certification Course Guide | `Edition 1.0` |
| Instructor **Foundation** Course Guide | `Edition 1.0` — renamed to Instructor *Certification* Course Guide |
| Document Architecture and Manual Revision | `Edition 2.0` |
| Manual Amendment Set R1 / R2 / R5 | covers `Edition 1.1`, `1.4`, `2.0` |

---

## Known gaps

- **The 7-Level Syllabus has no issued PDF yet.** Nor do the System Manual, the
  Instructor Course pair or the Assessment System Handbook — four of the eight
  are still drafts only. (The Examiner Notes Booklet *is* now issued, as
  `002-2`.)
- **Two Course Notes Booklets declare no version at all.** They cannot be placed
  on an edition timeline until they do.
- **The Syllabus numbering scheme is inconsistent with its own archived
  predecessor** (`Version 1.0` now, `Edition 2.0` then). Worth settling on one
  scheme across the document set.

---

## Where the portal depends on these

The portal implements rules stated in these documents. Changing a document does
not change the software — the two have to be moved together:

| Rule | Stated in | Enforced by |
|---|---|---|
| Seven levels, in order, no skipping | 7-Level Syllabus | `badge_level` enum; level helpers |
| Pass / Refer only, no partial pass | Assessment System Handbook | `assessment_outcome` enum |
| An examiner never assesses their own student | Manual; Assessment System Handbook | `enforce_assessment_coi()` — refuses the write |
| National fees: RM50 (L1–3), RM75 (L4–7) | Manual | assessment invoice build |
| Certificates are append-only; revoke and reissue | Assessment System Handbook | `certificates` + `certificate_revocations` |
| Examiner term of 2 years | Manual; Examiner Course Guide | examiner registry |

If you amend one of these clauses, open an issue against the portal in the same
breath. A governance change that never reaches the code is the most expensive
kind of drift this project has.
