#!/usr/bin/env node
// generate-sitemap.mjs — build-time sitemap generator.
//
// Runs before `vite build`. Reads the current list of PUBLISHED guides from
// Supabase (`list_public_guides()` RPC) and rewrites `public/sitemap.xml`
// with static pages + one <url> per live guide slug.
//
// Env vars (already set in Netlify — no extra config needed):
//   VITE_SUPABASE_URL              — Supabase project URL
//   VITE_SUPABASE_PUBLISHABLE_KEY  — anon "publishable" key (safe in build)
//
// Failure policy: if the RPC is unreachable or returns garbage, we DO NOT
// fail the build — we leave the existing sitemap.xml in place and print a
// warning. A stale sitemap is a much smaller problem than a red deploy.
//
// Adding new URL groups: edit STATIC_URLS below. Adding a new dynamic source
// (e.g. news posts): copy the guides block, adjust the RPC, merge into `urls`.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');
const OUTPUT     = resolve(REPO_ROOT, 'public', 'sitemap.xml');
const SITE       = 'https://www.masbadges.org';

// Static routes rendered on the public site. Anything that lives on the
// portal (apps.masbadges.org) is intentionally excluded — that host has a
// disallow-all robots policy and shouldn't be indexed.
const STATIC_URLS = [
  { loc: '/',                       changefreq: 'weekly',  priority: '1.0' },
  { loc: '/the-programme',          changefreq: 'monthly', priority: '0.9' },
  { loc: '/find-a-centre',          changefreq: 'daily',   priority: '0.9' },
  { loc: '/for-parents',            changefreq: 'monthly', priority: '0.8' },
  { loc: '/for-centres',            changefreq: 'monthly', priority: '0.8' },
  { loc: '/apply-partner-centre',   changefreq: 'monthly', priority: '0.7' },
  { loc: '/instructors',            changefreq: 'monthly', priority: '0.7' },
  { loc: '/courses',                changefreq: 'weekly',  priority: '0.7' },
  { loc: '/faq',                    changefreq: 'weekly',  priority: '0.8' },
  { loc: '/guides',                 changefreq: 'weekly',  priority: '0.8' },
  { loc: '/contact',                changefreq: 'yearly',  priority: '0.5' },
  { loc: '/privacy',                changefreq: 'yearly',  priority: '0.3' },
  { loc: '/terms',                  changefreq: 'yearly',  priority: '0.3' },
  { loc: '/safeguarding',           changefreq: 'yearly',  priority: '0.4' },
];

// XML-safe encoder for URLs (only the five predefined entities are
// technically required, but ampersand is the one that actually bites us).
function xmlEscape(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g, '&apos;');
}

function renderUrl({ loc, changefreq, priority, lastmod }) {
  const parts = [`  <url>`];
  parts.push(`    <loc>${xmlEscape(SITE + loc)}</loc>`);
  if (lastmod)    parts.push(`    <lastmod>${xmlEscape(lastmod)}</lastmod>`);
  if (changefreq) parts.push(`    <changefreq>${changefreq}</changefreq>`);
  if (priority)   parts.push(`    <priority>${priority}</priority>`);
  parts.push(`  </url>`);
  return parts.join('\n');
}

function renderSitemap(urls) {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls.map(renderUrl),
    `</urlset>`,
    ``,
  ].join('\n');
}

async function fetchGuideSlugs() {
  const url  = process.env.VITE_SUPABASE_URL;
  const key  = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
             ?? process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn('[sitemap] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY not set — skipping dynamic guide fetch.');
    return null;
  }

  const endpoint = `${url.replace(/\/+$/, '')}/rest/v1/rpc/list_public_guides`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'apikey':        key,
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
      },
      body: '{}',
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[sitemap] list_public_guides HTTP ${res.status} — falling back.`);
      return null;
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      console.warn('[sitemap] list_public_guides returned non-array — falling back.');
      return null;
    }
    // Each row is a guide card; slug is what we need for /guides/:slug.
    const slugs = data
      .map((g) => (g && typeof g.slug === 'string') ? g.slug.trim() : '')
      .filter((s) => s.length > 0);
    return slugs;
  } catch (err) {
    console.warn(`[sitemap] guide fetch failed: ${err?.message ?? err} — falling back.`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function guideUrl(slug) {
  return {
    loc: `/guides/${slug}`,
    changefreq: 'monthly',
    priority: '0.7',
  };
}

async function main() {
  const slugs = await fetchGuideSlugs();

  if (slugs === null) {
    // Fetch unavailable: keep whatever's already checked in. If the file
    // is somehow missing entirely, write a static-only fallback so the
    // build doesn't ship without any sitemap at all.
    if (existsSync(OUTPUT)) {
      console.warn(`[sitemap] leaving existing ${OUTPUT} in place.`);
      return;
    }
    const fallback = renderSitemap(STATIC_URLS);
    writeFileSync(OUTPUT, fallback, 'utf8');
    console.warn(`[sitemap] wrote static-only fallback (${STATIC_URLS.length} urls).`);
    return;
  }

  const dedupedSlugs = Array.from(new Set(slugs)).sort();
  const urls = [...STATIC_URLS, ...dedupedSlugs.map(guideUrl)];
  const xml  = renderSitemap(urls);

  // Skip the disk write when nothing changed — keeps mtimes stable and
  // makes the log line honest.
  const prev = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
  if (prev === xml) {
    console.log(`[sitemap] no changes (${urls.length} urls, ${dedupedSlugs.length} guides).`);
    return;
  }
  writeFileSync(OUTPUT, xml, 'utf8');
  console.log(`[sitemap] wrote ${urls.length} urls (${dedupedSlugs.length} guides).`);
}

main().catch((err) => {
  // Never fail the build. Warn and let vite proceed with the existing file.
  console.warn(`[sitemap] unexpected error: ${err?.message ?? err} — build continues.`);
  process.exit(0);
});
