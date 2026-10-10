/// <reference types="vite/client" />

// If a vite-env.d.ts already exists from the scaffold, merge these keys into it
// rather than keeping two copies.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Alias for ANON_KEY accepted by lib/supabase.ts and the sitemap script. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
