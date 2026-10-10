import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import EditableText from '../components/EditableText';

interface Row { id: string; full_name: string; state: string | null; centre_name: string | null; independent: boolean; }

export default function Instructors() {
  const [rows, setRows] = useState<Row[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [state, setState] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('instructor_directory').select('*').order('full_name');
    if (state) q = q.eq('state', state);
    const { data } = await q;
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [state]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('list_states');
      setStates(((data ?? []) as { state: string }[]).map((x) => x.state));
    })();
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="mas-page mas-instructors">
      <header className="mas-page-head">
        <p className="mas-eyebrow"><EditableText keyName="instructors.header.eyebrow">Instructors</EditableText></p>
        <h1><EditableText keyName="instructors.header.title">Certified BADGES instructors</EditableText></h1>
        <p className="mas-lede">
          <EditableText keyName="instructors.header.lede">
            Instructors are the core of the programme — the people who teach to the
            syllabus, prepare swimmers, and book assessments. Find a listed instructor
            below, learn the pathway to becoming one, or partner with a recognised centre.
          </EditableText>
        </p>
      </header>

      <div className="mas-inst-cta">
        <Link to="/guides/instructor-pathway" className="mas-inst-cta-card">
          <span className="mas-inst-cta-aud">Want to become one?</span>
          <strong>The instructor pathway</strong>
          <span className="mas-inst-cta-go">How to get certified →</span>
        </Link>
        <Link to="/find-a-centre" className="mas-inst-cta-card">
          <span className="mas-inst-cta-aud">Looking for lessons?</span>
          <strong>Find a recognised centre</strong>
          <span className="mas-inst-cta-go">Browse the directory →</span>
        </Link>
      </div>

      <div className="mas-dir-filter">
        <label className="mas-field-label" htmlFor="st">Filter by state</label>
        <select id="st" className="mas-select" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">All states</option>
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading && (
        <p className="mas-status">
          <EditableText keyName="instructors.status.loading">Loading…</EditableText>
        </p>
      )}
      {!loading && rows.length === 0 && (
        <div className="mas-alert is-info">
          <div className="mas-alert-body">
            <p className="mas-alert-title"><EditableText keyName="instructors.empty.title">No instructors are publicly listed yet.</EditableText></p>
            <p className="mas-alert-text">
              <EditableText keyName="instructors.empty.body">
                Listing is opt-in — certified instructors can choose to appear here from
                their portal account. In the meantime, find a recognised centre in the directory.
              </EditableText>
            </p>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mas-inst-grid">
          {rows.map((r) => (
            <article key={r.id} className="mas-inst-card">
              <div className="mas-inst-avatar" aria-hidden="true">{(r.full_name || '?').charAt(0).toUpperCase()}</div>
              <div className="mas-inst-body">
                <h3>{r.full_name}</h3>
                <p className="mas-inst-meta">
                  {r.independent ? 'Independent instructor' : r.centre_name || 'Partner centre'}
                  {r.state ? ` · ${r.state}` : ''}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="mas-inst-note">
        <EditableText keyName="instructors.note">
          Are you a certified BADGES instructor? You can choose to be listed here from your
          portal account — listing is always opt-in.
        </EditableText>
      </p>
    </section>
  );
}
