import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { buildGuideEntries, searchSite, type GuideCardForSearch, type SearchEntry } from '../data/searchIndex';
import { supabase } from '../lib/supabase';
import '../styles/public.css';

/**
 * Site-wide search results for the public marketing site. The active query lives
 * in the URL (`/search?q=…`) so a results view is shareable and linkable. Results
 * come from the static, public-only search index (`searchSite`) supplemented at
 * runtime with the current set of published guides (`list_public_guides()` RPC)
 * so guide content stays discoverable now that guides live in the database.
 * This page never touches portal data.
 */
export default function SearchResults() {
  const [params] = useSearchParams();
  const query = params.get('q') ?? '';
  const trimmed = query.trim();

  const [guideEntries, setGuideEntries] = useState<SearchEntry[]>([]);
  const [guidesLoaded, setGuidesLoaded] = useState(false);
  const [guidesFailed, setGuidesFailed] = useState(false);

  // One-shot fetch of published guides. We build search entries from the RPC
  // response once, then keep them in state — searchSite is a pure filter so
  // re-running it on every query change is cheap.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('list_public_guides');
      if (cancelled) return;
      // Guides are one source among several here, so a failure degrades the
      // results rather than emptying the page — but say so instead of quietly
      // returning fewer hits than the site actually has.
      setGuidesFailed(Boolean(error));
      const cards = (Array.isArray(data) ? data : []) as GuideCardForSearch[];
      setGuideEntries(buildGuideEntries(cards));
      setGuidesLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const results = searchSite(query, guideEntries);

  // Reset the scroll position whenever the query changes. ScrollToTop only fires
  // on a pathname change, and searching again from this page keeps the same
  // `/search` path, so we mirror that behaviour here to land at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [query]);

  return (
    <section className="mas-page">
      <header className="mas-page-head">
        <p className="mas-eyebrow">Search</p>
        <h1>{trimmed ? `Results for “${trimmed}”` : 'Search the site'}</h1>
        {trimmed ? (
          <p className="mas-lede">
            {!guidesLoaded && 'Loading…'}
            {guidesLoaded && (
              results.length === 0
                ? 'No matching pages.'
                : `${results.length} result${results.length === 1 ? '' : 's'} across the programme, guides, FAQs and pages.`
            )}
          </p>
        ) : (
          <p className="mas-lede">
            Search the MAS BADGES site — the programme, guides, FAQs, fees and centre
            information. Use the search box in the header to begin.
          </p>
        )}
      </header>

      {guidesFailed && (
        <p className="mas-status mas-status-bad">
          Guides couldn’t be loaded, so these results are incomplete.
        </p>
      )}

      {trimmed && guidesLoaded && results.length === 0 && (
        <div className="mas-search-empty">
          <p>
            We couldn’t find anything matching <strong>“{trimmed}”</strong>.
          </p>
          <p className="mas-muted">
            Try a different word, or browse the <Link to="/the-programme">programme</Link>,{' '}
            <Link to="/guides">guides</Link> or <Link to="/faq">FAQ</Link>.
          </p>
        </div>
      )}

      {results.length > 0 && (
        <ol className="mas-search-results">
          {results.map((r, i) => (
            <li key={`${r.route}-${i}`} className="mas-search-result">
              <Link to={r.route} className="mas-search-result-link">
                <span className="mas-search-result-source">{r.source}</span>
                <span className="mas-search-result-title">{r.title}</span>
                <span className="mas-search-result-snippet">{r.snippet}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
