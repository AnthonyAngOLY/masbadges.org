import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App.tsx'
import UpdateBanner from './components/UpdateBanner.tsx'
import { isSupabaseConfigured } from './lib/supabase'
import './index.css'

const dsn = import.meta.env.VITE_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  })
}

// A build with no Supabase credentials used to render nothing at all: the
// client threw while this module was still loading, so React never mounted and
// the viewer got a white page with the reason only in the console. Say it on
// screen instead. Deliberately plain markup — this path must not depend on
// anything that could itself be missing.
function NotConfigured() {
  return (
    <main style={{ maxWidth: '34rem', margin: '4rem auto', padding: '0 1.25rem',
                   fontFamily: 'system-ui, sans-serif', color: '#0a1f44', lineHeight: 1.6 }}>
      <h1 style={{ fontSize: '1.4rem', marginBottom: '0.75rem' }}>This site isn’t configured yet</h1>
      <p>
        The build is missing its database credentials, so nothing can load.
        Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>
        {' '}(or <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>) in the Netlify
        environment variables and redeploy.
      </p>
      <p style={{ color: '#5d6b85' }}>If you’re a visitor, please try again shortly.</p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<p>Something went wrong. The team has been notified.</p>}>
      {isSupabaseConfigured ? (
        <>
          <App />
          <UpdateBanner />
        </>
      ) : (
        <NotConfigured />
      )}
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
