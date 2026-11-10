// src/data/searchIndex.ts
// Single source-of-truth, static content index for site-wide search across the
// PUBLIC marketing site only. Page titles, section headings, key body copy, FAQs,
// and the level pathway are indexed here.
//
// SAFETY: this module indexes the public site's OWN page copy only. It must never
// reference candidate, certificate, member, or any minor data — those live behind
// the portal's RLS surfaces and are out of bounds for search. Keep it that way.
//
// Maintainability:
//   - FAQ and Level entries are DERIVED from their existing source-of-truth
//     data modules (faqs.ts, levels.ts) so they never drift out of sync.
//   - GUIDES used to live in a static `guides.ts` module (also indexed here) but
//     have moved to the database (`guide_cards` / `guide_sections`, served via
//     the `list_public_guides()` RPC). Guide search entries are now built at
//     runtime via `buildGuideEntries()` below and merged into the search index
//     by SearchResults after the RPC returns.
//   - Static page copy (Home, About, For parents, …) has no data module behind it,
//     so those entries are hand-authored below in PAGE_ENTRIES. To add or edit a
//     page entry, edit that one array.

import { LEVELS } from './levels';
import { FAQ_CATEGORIES } from './faqs';

export interface SearchEntry {
  /** Short, human-readable title for the result. */
  title: string;
  /** Short excerpt shown under the title. */
  snippet: string;
  /** Destination route, with an anchor (#…) where one exists on the page. */
  route: string;
  /** Source page / section label, e.g. "The programme · Fees" or "FAQ · For parents". */
  source: string;
  /**
   * Fuller text used for matching only (not necessarily displayed). Lets a query
   * match the full body of an FAQ answer or guide section while `snippet` stays short.
   */
  body?: string;
}

/** Shape of a guide card as returned by `list_public_guides()`. Sections are
 *  optional so a card with none still indexes cleanly. Kept intentionally loose
 *  — we only require the fields we actually read for search entries. */
export interface GuideSectionForSearch {
  heading?: string | null;
  body?: string | null;
  steps?: string[] | null;
  points?: string[] | null;
  note?: string | null;
}
export interface GuideCardForSearch {
  slug: string;
  title: string;
  audience?: string | null;
  summary?: string | null;
  sections?: GuideSectionForSearch[] | null;
}

// Trim a longer string down to a display-friendly excerpt on a word boundary.
function excerpt(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : max).trim()}…`;
}

// ---------------------------------------------------------------------------
// 1. Static public pages (hand-authored — no data module behind these).
// ---------------------------------------------------------------------------
const PAGE_ENTRIES: SearchEntry[] = [
  // Home (/)
  { title: 'Learn-to-Swim Badges',
    snippet: 'A skill-progression programme for swimmers aged 5–12 — from first water familiarisation through to competitive readiness, across seven levels.',
    route: '/', source: 'Home' },
  { title: 'From first splash to finish line',
    snippet: 'Seven levels take a child from water familiarisation to competitive readiness — each one a clear, assessed step with a badge to show for it.',
    route: '/', source: 'Home · How it works' },
  { title: 'Learn at a centre you can trust',
    snippet: 'BADGES is taught at partner centres across Malaysia, each one accredited to the national standard. Find one near you and enrol your child.',
    route: '/find-a-centre', source: 'Home · Find a centre' },

  // The programme (/the-programme)
  { title: 'Seven badges, one national pathway',
    snippet: 'The MAS Swim Badges programme takes a child from their very first day in the water through to competitive readiness — a clear, standardised pathway with the same meaning at every recognised centre.',
    route: '/the-programme', source: 'The programme' },
  { title: 'How assessment works',
    snippet: 'A child is prepared by their instructor, then assessed by an independent examiner with no conflict of interest. On a pass, a serialised certificate anyone can verify online is issued.',
    route: '/the-programme', source: 'The programme · How assessment works' },
  { title: 'Assessment fees',
    snippet: 'Assessment fees are set nationally: RM 50 per level for Starfish, Sea Turtle and Guppy, and RM 75 per level for Octopus, Frog, Swordfish and Dolphin. Centres set their own tuition separately.',
    route: '/the-programme', source: 'The programme · Fees' },

  // For parents (/for-parents)
  { title: 'A national standard you can trust',
    snippet: 'The MAS Swim Badges programme gives your child a clear, step-by-step path in the water — and a badge that means the same thing at every recognised centre in Malaysia.',
    route: '/for-parents', source: 'For parents' },
  { title: 'What a badge means',
    snippet: 'Each badge marks a defined set of skills. Your child is prepared by their instructor and then assessed by an independent examiner, so the badge reflects a genuinely met standard, not just attendance.',
    route: '/for-parents', source: 'For parents · What a badge means' },
  { title: 'Child safety',
    snippet: 'Assessments are conducted by independent examiners under conflict-of-interest rules, and your child’s personal details are never shown publicly. Verification works by serial only.',
    route: '/for-parents', source: 'For parents · Child safety' },
  { title: 'Getting started',
    snippet: 'Find a recognised centre near you and enrol. When your child earns a badge, you’ll receive a claim code to link their record to your own account.',
    route: '/for-parents', source: 'For parents · Getting started' },

  // For centres (/for-centres)
  { title: 'Become a recognised partner centre',
    snippet: 'Recognition places your swim school inside Malaysia’s national badge standard — a credential parents can trust and verify, and a clear point of difference for your centre.',
    route: '/for-centres', source: 'For centres' },
  { title: 'Why join as a partner centre',
    snippet: 'Listed in the public centre directory, register candidates and book independently-assessed sessions, and offer nationally recognised, verifiable certificates for your swimmers.',
    route: '/for-centres', source: 'For centres · Why join' },
  { title: 'What a partner centre requires',
    snippet: 'At least one MAS BADGES–certified instructor on your roster at all times, delivery of the national syllabus, child-safety standards, and assessments by an independent examiner.',
    route: '/for-centres', source: 'For centres · What’s required' },
  { title: 'How partnership works',
    snippet: 'Enquire, appoint a certified instructor who registers the centre, gain approval and settle the partnership fee, then appear in the public directory and begin booking assessments.',
    route: '/for-centres', source: 'For centres · How partnership works' },

  // About (Home · /#about)
  { title: 'About the programme',
    snippet: 'MAS Swim Badges is the national Learn-to-Swim certification framework of Malaysia Aquatics — a clear, standardised pathway from a child’s first day in the water through to competitive readiness.',
    route: '/#about', source: 'About' },
  { title: 'How the programme is run',
    snippet: 'Governed by Malaysia Aquatics through its Board and Coaching & Technical Board. A Chairperson leads, a Chief Examiner oversees assessment standards, and Master Trainers run the courses.',
    route: '/#about', source: 'About · How it’s run' },
  { title: 'Who governs the programme',
    snippet: 'Chairperson, Chief Examiner, Master Trainer, and the Coaching & Technical Board — the roles that govern the syllabus, assessment standard, and certification courses.',
    route: '/#about', source: 'About · Who governs it' },
  { title: 'What makes a badge trustworthy',
    snippet: 'Independent assessment, one national standard, and verifiable certificates — serialised, issued only on a genuine pass, and publicly verifiable without exposing a child’s identity.',
    route: '/#about', source: 'About · What makes a badge trustworthy' },

  // Centre finder (/find-a-centre)
  { title: 'Find a swim centre',
    snippet: 'Centres recognised by Malaysia Aquatics to prepare and present candidates for the Swim Badges programme. Filter by state — only recognised centres appear here.',
    route: '/find-a-centre', source: 'Find a centre' },

  // Instructors (/instructors)
  { title: 'Certified BADGES instructors',
    snippet: 'Instructors are the core of the programme — they teach to the syllabus, prepare swimmers, and book assessments. Find a listed instructor or learn the pathway to becoming one.',
    route: '/instructors', source: 'Instructors' },

  // Courses (/courses)
  { title: 'Courses & certification',
    snippet: 'Upcoming instructor and examiner certification courses and clinics under the MAS Swim Badges programme.',
    route: '/courses', source: 'Courses' },

  // Verify (/verify)
  { title: 'Verify a certificate',
    snippet: 'Enter the serial printed on a Swim Badges certificate to confirm it is genuine. For the privacy of our young swimmers, no personal details are shown — only that the certificate is authentic.',
    route: '/verify', source: 'Verify' },

  // Contact (/contact)
  { title: 'Contact & enquiries',
    snippet: 'Choose the option that fits — centre partnership, certified instructor, parent / swimmer, or general — and your enquiry goes straight to the right person at Malaysia Aquatics.',
    route: '/contact', source: 'Contact' },

  // Legal / safeguarding
  { title: 'Safeguarding',
    snippet: 'How MAS BADGES protects children: independent assessment, no public exposure of a minor’s identity, and verification by serial only.',
    route: '/safeguarding', source: 'Safeguarding' },
  { title: 'Privacy policy',
    snippet: 'How Malaysia Aquatics handles personal data across the MAS BADGES public site and portal.',
    route: '/privacy', source: 'Privacy' },
  { title: 'Terms of use',
    snippet: 'The terms governing use of the MAS BADGES website and services.',
    route: '/terms', source: 'Terms' },
];

// ---------------------------------------------------------------------------
// 2. Level pathway — derived from levels.ts (anchors to /the-programme#level-N).
// ---------------------------------------------------------------------------
const LEVEL_ENTRIES: SearchEntry[] = LEVELS.map((l) => ({
  title: `Level ${l.level}: ${l.name}`,
  snippet: l.outcome,
  route: `/the-programme#level-${l.level}`,
  source: `The programme · Level ${l.level}`,
  body: `${l.blurb} ${l.outcome}`,
}));

// ---------------------------------------------------------------------------
// 3. FAQs — derived from faqs.ts (anchors to /faq#faq-{category}).
// ---------------------------------------------------------------------------
const FAQ_ENTRIES: SearchEntry[] = FAQ_CATEGORIES.flatMap((cat) =>
  cat.items.map((it) => ({
    title: it.q,
    snippet: excerpt(it.a),
    route: `/faq#faq-${cat.key}`,
    source: `FAQ · ${cat.title}`,
    body: `${it.q} ${it.a}`,
  })),
);

// ---------------------------------------------------------------------------
// 4. Guides — built at RUNTIME from `list_public_guides()` (see helper below).
//    SearchResults fetches once on mount and passes the result into searchSite.
// ---------------------------------------------------------------------------

/** Convert one guide-section payload into its text-only body used for matching. */
function sectionText(s: GuideSectionForSearch): string {
  return [s.body ?? '', s.note ?? '', ...(s.steps ?? []), ...(s.points ?? [])]
    .filter(Boolean)
    .join(' ');
}

/**
 * Turn a set of guide cards (as returned by list_public_guides RPC) into the
 * flat list of SearchEntry rows that previously lived in the static index.
 * One overview entry per card + one entry per section. Same shape as before,
 * so SearchResults doesn't need to know these came from the database.
 */
export function buildGuideEntries(cards: GuideCardForSearch[] | null | undefined): SearchEntry[] {
  if (!Array.isArray(cards)) return [];
  return cards.flatMap((g) => {
    const summary = g.summary ?? '';
    const audience = g.audience ?? '';
    const sections = Array.isArray(g.sections) ? g.sections : [];

    const overview: SearchEntry = {
      title: g.title,
      snippet: summary,
      route: `/guides/${g.slug}`,
      source: `Guides · ${audience}`,
      body: `${g.title} ${summary} ${sections.map(sectionText).join(' ')}`,
    };

    const sectionEntries: SearchEntry[] = sections
      .filter((s) => (s.heading ?? '').trim().length > 0)
      .map((s) => ({
        title: s.heading as string,
        snippet: excerpt(sectionText(s)) || summary,
        route: `/guides/${g.slug}`,
        source: `Guides · ${g.title}`,
        body: `${s.heading} ${sectionText(s)}`,
      }));

    return [overview, ...sectionEntries];
  });
}

// ---------------------------------------------------------------------------
// The static portion of the search index (loaded synchronously at import time).
// ---------------------------------------------------------------------------
export const SEARCH_INDEX: SearchEntry[] = [
  ...PAGE_ENTRIES,
  ...LEVEL_ENTRIES,
  ...FAQ_ENTRIES,
];

/**
 * Case-insensitive, partial-match search over the static content index, optionally
 * supplemented with runtime-built entries (e.g. guides fetched from Supabase).
 * Matches the query against each entry's title, snippet, and (where present)
 * fuller body text. Returns matching entries; an empty/whitespace query returns [].
 */
export function searchSite(query: string, extra: SearchEntry[] = []): SearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const haystack = [...SEARCH_INDEX, ...extra];
  return haystack.filter((e) => {
    const hay = `${e.title} ${e.snippet} ${e.body ?? ''}`.toLowerCase();
    return hay.includes(q);
  });
}
