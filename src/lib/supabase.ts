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

// createClient throws on an empty url or key. That throw happens at module load,
// before React mounts and out of any ErrorBoundary's reach, which took the whole
// site down to an empty <div id="root"> with nothing on screen. Fall back to
// inert placeholders so the app can get far enough to explain itself; every
// query against them fails, which is why main.tsx gates on isSupabaseConfigured.
export const supabase = createClient(
  url || 'https://unconfigured.invalid',
  anonKey || 'unconfigured',
);
