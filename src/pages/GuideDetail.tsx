import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import EditableText from '../components/EditableText';

interface Section {
  id: string;
  heading: string;
  body: string | null;
  steps: string[] | null;
  points: string[] | null;
  note: string | null;
  image1_url: string | null;
  image1_caption: string | null;
  image2_url: string | null;
  image2_caption: string | null;
  sort_order: number;
}
interface Guide {
  id: string;
  slug: string;
  title: string;
  audience: string;
  accent: string;
  summary: string;
  image1_url: string | null;
  image1_caption: string | null;
  image2_url: string | null;
  image2_caption: string | null;
  sections: Section[];
}

// Zero-footprint image + optional caption block. Renders nothing when url is null.
function ImageFig({ url, caption, alt }: { url: string | null; caption: string | null; alt: string }) {
  if (!url) return null;
  return (
    <figure style={{ margin: '1rem 0', borderRadius: '10px', overflow: 'hidden' }}>
      <img src={url} alt={caption || alt} loading="lazy" style={{ width: '100%', height: 'auto', display: 'block' }} />
      {caption && (
        <figcaption style={{ fontSize: '0.85rem', color: 'var(--mas-muted, #5b6472)', marginTop: '0.5rem', textAlign: 'center' }}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

export default function GuideDetail() {
  const { slug } = useParams();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('list_public_guides');
      if (cancelled) return;
      // A failed fetch must not render as "Guide not found" — that tells the
      // visitor the page is gone when the database simply couldn't be reached.
      setLoadFailed(Boolean(error));
      const arr: Guide[] = Array.isArray(data) ? (data as Guide[]) : [];
      setGuide(arr.find((g) => g.slug === slug) ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) {
    return (
      <section className="mas-page">
        <header className="mas-page-head"><p className="mas-status">Loading…</p></header>
      </section>
    );
  }

  if (loadFailed) {
    return (
      <section className="mas-page">
        <header className="mas-page-head">
          <h1>Couldn’t load this guide</h1>
          <p className="mas-lede">Something went wrong reaching the site content. Please try again shortly.</p>
        </header>
        <Link to="/guides" className="mas-link">← All guides</Link>
      </section>
    );
  }

  if (!guide) {
    return (
      <section className="mas-page">
        <header className="mas-page-head">
          <h1><EditableText keyName="guides.detail.notfound.title">Guide not found</EditableText></h1>
          <p className="mas-lede">
            <EditableText keyName="guides.detail.notfound.lede">That guide doesn’t exist or has moved.</EditableText>
          </p>
        </header>
        <Link to="/guides" className="mas-link"><EditableText keyName="guides.detail.notfound.back">← All guides</EditableText></Link>
      </section>
    );
  }

  return (
    <section className="mas-page mas-guide" style={{ ['--lvl' as string]: guide.accent }}>
      <Link to="/guides" className="mas-guide-back"><EditableText keyName="guides.detail.back">← All guides</EditableText></Link>
      <header className="mas-page-head mas-guide-head">
        <p className="mas-eyebrow" style={{ color: guide.accent }}>{guide.audience}</p>
        <h1>{guide.title}</h1>
        <p className="mas-lede">{guide.summary}</p>

        {/* Header images — zero-footprint if either missing */}
        <ImageFig url={guide.image1_url} caption={guide.image1_caption} alt={guide.title} />
        <ImageFig url={guide.image2_url} caption={guide.image2_caption} alt={guide.title} />
      </header>

      {guide.sections.map((s) => (
        <section key={s.id} className="mas-guide-section">
          <h2>{s.heading}</h2>
          {s.body && <p>{s.body}</p>}
          {s.steps && s.steps.length > 0 && (
            <ol className="mas-guide-steps">
              {s.steps.map((st, j) => <li key={j}>{st}</li>)}
            </ol>
          )}
          {s.points && s.points.length > 0 && (
            <ul className="mas-guide-points">
              {s.points.map((p, j) => <li key={j}>{p}</li>)}
            </ul>
          )}
          {s.note && <p className="mas-guide-note">{s.note}</p>}

          {/* Section images — zero footprint if missing */}
          <ImageFig url={s.image1_url} caption={s.image1_caption} alt={s.heading} />
          <ImageFig url={s.image2_url} caption={s.image2_caption} alt={s.heading} />
        </section>
      ))}

      <div className="mas-guide-foot">
        <Link to="/guides" className="mas-link"><EditableText keyName="guides.detail.foot.back">← Back to all guides</EditableText></Link>
        <Link to="/faq" className="mas-link"><EditableText keyName="guides.detail.foot.faq">Browse the FAQ →</EditableText></Link>
      </div>
    </section>
  );
}
