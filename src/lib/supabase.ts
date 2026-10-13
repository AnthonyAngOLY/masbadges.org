import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;

// Two names for the same publishable ("anon") key are in circulation: this file
// has always read ANON_KEY, while env.example and scripts/generate-sitemap.mjs
// use PUBLISHABLE_KEY. Accept either, so a correctly-filled .env copied from
// env.example cannot produce a blank site.
const anonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * False when the build carries no Supabase credentials. `main.tsx` renders a
 * notice instead of the app, rather than leaving the viewer on a blank page.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  console.error(
    'Missing VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY ' +
      '(VITE_SUPABASE_PUBLISHABLE_KEY is accepted for the key). Set them in Netlify env vars.',
  );
}

/**
 * Ceiling on any single request. supabase-js sets no timeout of its own, so a
 * connection that is accepted and then stalls — a phone moving between networks,
 * a captive portal, an edge that holds the socket open — leaves the promise
 * pending forever and the page sitting on "Loading…" with nothing to show and
 * no way to retry. Measured: with a server that accepts and never answers, the
 * public pages never settled at all.
 *
 * Aborting converts that into the ordinary error path every page already
 * handles, so the user gets "couldn't load, try again" instead of a spinner.
 *
 * This is a PER-ATTEMPT budget, not a total one. supabase-js retries a failed
 * REST request internally — measured at four calls into this wrapper for a
 * single .from().select(), spaced by roughly 1s, 2s and 4s — so a stalled
 * connection takes about 4x this value to surface. Those retries are worth
 * keeping (a transient blip recovers without the user seeing anything), so the
 * per-attempt value is what gets tuned.
 *
 * 10s: Postgres applies its own statement_timeout below this, so a genuinely
 * slow query returns a server error long before the client gives up, and this
 * only catches connections that have stopped making progress entirely. The
 * common failures — a 500, a refused connection, bad DNS — still surface in
 * under a second, because they fail rather than stall.
 */
const REQUEST_TIMEOUT_MS = 10_000;

const fetchWithTimeout: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

// createClient throws on an empty url or key. That throw happens at module load,
// before React mounts and out of any ErrorBoundary's reach, which took the whole
// site down to an empty <div id="root"> with nothing on screen. Fall back to
// inert placeholders so the app can get far enough to explain itself; every
// query against them fails, which is why main.tsx gates on isSupabaseConfigured.
export const supabase = createClient(
  url || 'https://unconfigured.invalid',
  anonKey || 'unconfigured',
  { global: { fetch: fetchWithTimeout } },
);
