import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import EditableText from '../components/EditableText';

interface GuideCardLite {
  id: string;
  slug: string;
  title: string;
  audience: string;
  accent: string;
  summary: string;
  sort_order: number;
  image1_url: string | null;
  image1_caption: string | null;
  image2_url: string | null;
  image2_caption: string | null;
}

export default function Guides() {
  const [cards, setCards] = useState<GuideCardLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('list_public_guides');
      if (cancelled) return;
      // Without this, an unreachable database is indistinguishable from
      // "nothing is published" — the visitor is told the wrong thing.
      setLoadFailed(Boolean(error));
      const arr: GuideCardLite[] = Array.isArray(data) ? (data as GuideCardLite[]) : [];
      setCards(arr);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="mas-page mas-guides">
      <header className="mas-page-head">
        <p className="mas-eyebrow"><EditableText keyName="guides.index.eyebrow">Guides</EditableText></p>
        <h1><EditableText keyName="guides.index.title">How the programme works, for you</EditableText></h1>
        <p className="mas-lede">
          <EditableText keyName="guides.index.lede">
            Clear walk-throughs for every part of MAS BADGES — from getting your
            child started, to becoming an instructor, to how assessment and
            certification actually run.
          </EditableText>
        </p>
      </header>

      {loading && <p className="mas-status">Loading…</p>}

      {!loading && loadFailed && (
        <p className="mas-status mas-status-bad">
          Couldn’t load the guides just now. Please try again shortly.
        </p>
      )}

      {!loading && !loadFailed && cards.length === 0 && (
        <p className="mas-status">No guides are currently published.</p>
      )}

      {!loading && cards.length > 0 && (
        <div className="mas-guidegrid">
          {cards.map((g) => (
            <Link key={g.id} to={`/guides/${g.slug}`} className="mas-guidecard" style={{ ['--lvl' as string]: g.accent }}>
              {/* Optional header image — zero footprint when missing */}
              {g.image1_url && (
                <figure style={{ margin: '0 0 0.75rem', borderRadius: '10px', overflow: 'hidden' }}>
                  <img
                    src={g.image1_url}
                    alt={g.image1_caption || g.title}
                    loading="lazy"
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                  />
                  {g.image1_caption && (
                    <figcaption style={{ fontSize: '0.78rem', color: 'var(--mas-muted, #5b6472)', marginTop: '0.4rem', textAlign: 'center' }}>
                      {g.image1_caption}
                    </figcaption>
                  )}
                </figure>
              )}
              <span className="mas-guidecard-aud">{g.audience}</span>
              <h2>{g.title}</h2>
              <p>{g.summary}</p>
              <span className="mas-guidecard-go">Read the guide →</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
