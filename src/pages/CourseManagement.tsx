// #16 — Course management, dense-table conversion.
// Design note: a course has ~10 fields at creation (kind/title/description/
// state/venue/starts/ends/capacity/fee/url). Same reasoning as Memberships —
// forced single-row inline-add would be worse than a form. Use a COMPACT
// CREATE PANEL at the top; the listing is a dense table with Active/Archived
// tabs. Archive uses set_course_archived (unit 16.C SQL).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import '../styles/admin.css';

interface Course {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  state: string | null;
  venue: string | null;
  starts_on: string;
  ends_on: string | null;
  capacity: number | null;
  fee: number | null;
  registration_url: string | null;
  is_published: boolean;
  archived_at: string | null;
}
interface StateRow { state: string; }
type Load = 'loading' | 'ready' | 'error';
type Tab = 'active' | 'archived';

const KINDS: { value: string; label: string }[] = [
  { value: 'instructor_certification', label: 'Instructor certification' },
  { value: 'examiner_certification', label: 'Examiner certification' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'other', label: 'Other' },
];

function prettyDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function kindLabel(k: string): string {
  return KINDS.find((x) => x.value === k)?.label ?? k;
}

const CSS = `
.mas-create-panel {
  background:#f5f8fc; border:1px solid var(--mas-line,#e3e9f3); border-radius:10px;
  padding:0.8rem 0.9rem; margin-bottom:1rem;
}
.mas-create-title {
  font-family:'Barlow Condensed',Arial,sans-serif; font-weight:800;
  color:var(--mas-navy,#1E2752); font-size:0.95rem; letter-spacing:.5px;
  text-transform:uppercase; margin:0 0 0.5rem;
}
.mas-create-row { display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; }
.mas-create-row + .mas-create-row { margin-top:0.5rem; }
.mas-create-row input, .mas-create-row select {
  font:inherit; padding:0.35rem 0.5rem; border:1px solid var(--mas-line,#e3e9f3); border-radius:6px;
}
.mas-create-row .mas-create-label { font-size:0.78rem; color:var(--mas-muted,#5b6472); }
.mas-create-row input[type=text], .mas-create-row input[type=url] { min-width:16rem; flex:1 1 18rem; }
.mas-create-row input.small { min-width:6rem; max-width:9rem; flex:0 0 auto; }
.mas-create-row select { min-width:10rem; }
`;

export default function CourseManagement() {
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [courses, setCourses] = useState<Course[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [tab, setTab] = useState<Tab>('active');

  const [kind, setKind] = useState('instructor_certification');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stateVal, setStateVal] = useState('');
  const [venue, setVenue] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [capacity, setCapacity] = useState('');
  const [fee, setFee] = useState('');
  const [regUrl, setRegUrl] = useState('');

  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchCourses = useCallback(async () => {
    setLoad('loading');
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .order('starts_on', { ascending: false });
    if (error) { setLoad('error'); return; }
    setCourses((data ?? []) as Course[]);
    setLoad('ready');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('list_states');
      if (error) { console.error('list_states failed:', error.message); return; }
      if (!cancelled) setStates(((data ?? []) as StateRow[]).map((x) => x.state));
    })();
    fetchCourses();
    return () => { cancelled = true; };
  }, [fetchCourses]);

  const canCreate = !!title.trim() && !!startsOn && !busy && !!me;

  async function create() {
    if (!canCreate) return;
    setBusy(true); setNotice(null); setError(null);
    const { error } = await supabase.from('courses').insert({
      kind,
      title: title.trim(),
      description: description.trim() || null,
      state: stateVal || null,
      venue: venue.trim() || null,
      starts_on: startsOn,
      ends_on: endsOn || null,
      capacity: capacity ? Number(capacity) : null,
      fee: fee ? Number(fee) : null,
      registration_url: regUrl.trim() || null,
      is_published: false,
      created_by_profile_id: me,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setNotice('Course created as a draft. Publish it when you’re ready.');
    setTitle(''); setDescription(''); setVenue(''); setStartsOn(''); setEndsOn('');
    setCapacity(''); setFee(''); setRegUrl('');
    fetchCourses();
  }

  async function togglePublish(c: Course) {
    setBusyId(c.id); setError(null);
    const { error } = await supabase.from('courses').update({ is_published: !c.is_published }).eq('id', c.id);
    setBusyId(null);
    if (error) { setError(error.message); return; }
    setCourses((list) => list.map((x) => (x.id === c.id ? { ...x, is_published: !c.is_published } : x)));
  }

  async function setArchived(c: Course, archived: boolean) {
    setBusyId(c.id); setError(null);
    const { error } = await supabase.rpc('set_course_archived', { _course_id: c.id, _archived: archived });
    setBusyId(null);
    if (error) { setError(error.message); return; }
    setCourses((list) => list.map((x) =>
      x.id === c.id ? { ...x, archived_at: archived ? new Date().toISOString() : null } : x));
  }

  const counts = useMemo(() => ({
    active: courses.filter((c) => !c.archived_at).length,
    archived: courses.filter((c) => !!c.archived_at).length,
  }), [courses]);

  const filtered = useMemo(
    () => courses.filter((c) => (tab === 'active' ? !c.archived_at : !!c.archived_at)),
    [courses, tab],
  );

  return (
    <section className="mas-page">
      <style>{CSS}</style>
      <header className="mas-page-head">
        <p className="mas-eyebrow">Training</p>
        <h1>Manage courses</h1>
        <p className="mas-lede">
          Schedule certification courses and clinics. Drafts are private; publish a
          course to list it on the public Courses page. Archive retires a course from
          the listing without deleting its record.
        </p>
      </header>

      {/* ---- Compact create panel ---- */}
      <div className="mas-create-panel">
        <p className="mas-create-title">Create a course</p>
        <div className="mas-create-row">
          <label className="mas-create-label">Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <input type="text" value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="mas-create-row">
          <input type="text" value={description} placeholder="Description (optional)"
            onChange={(e) => setDescription(e.target.value)} />
          <label className="mas-create-label">State</label>
          <select value={stateVal} onChange={(e) => setStateVal(e.target.value)}>
            <option value="">Any</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="text" value={venue} placeholder="Venue (optional)"
            onChange={(e) => setVenue(e.target.value)} />
        </div>
        <div className="mas-create-row">
          <label className="mas-create-label">Starts</label>
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className="small" />
          <label className="mas-create-label">Ends</label>
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className="small" />
          <label className="mas-create-label">Capacity</label>
          <input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} className="small" />
          <label className="mas-create-label">Fee (RM)</label>
          <input type="number" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} className="small" />
        </div>
        <div className="mas-create-row">
          <input type="url" value={regUrl} placeholder="Registration link (https://…) — optional"
            onChange={(e) => setRegUrl(e.target.value)} />
          <button className="mas-btn-primary mas-btn-compact" onClick={create} disabled={!canCreate}>
            {busy ? 'Creating…' : '+ Create'}
          </button>
        </div>
        {error && <p className="mas-status mas-status-bad" style={{ marginTop: '0.4rem' }}>{error}</p>}
        {notice && <p className="mas-status mas-status-good" style={{ marginTop: '0.4rem' }}>{notice}</p>}
      </div>

      {/* ---- Tabs ---- */}
      <div className="mas-admin-toolbar" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
        <button className="mas-btn-ghost" onClick={fetchCourses} disabled={load === 'loading'}>Refresh</button>
        <div className="mas-tabs" role="tablist" style={{ display: 'flex', gap: '0.3rem' }}>
          <button role="tab" aria-selected={tab === 'active'}
            className={tab === 'active' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => setTab('active')}>Active ({counts.active})</button>
          <button role="tab" aria-selected={tab === 'archived'}
            className={tab === 'archived' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => setTab('archived')}>Archived ({counts.archived})</button>
        </div>
        {load === 'ready' && <span className="mas-admin-count">{filtered.length} shown</span>}
      </div>

      {load === 'loading' && <p className="mas-status">Loading…</p>}
      {load === 'error' && <p className="mas-status mas-status-bad">Couldn’t load courses.</p>}
      {load === 'ready' && filtered.length === 0 && (
        <p className="mas-status">No courses in this view.</p>
      )}

      {load === 'ready' && filtered.length > 0 && (
        <div className="mas-table-wrap">
          <table className="mas-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>State / Venue</th>
                <th>Dates</th>
                <th className="mas-num">Fee</th>
                <th>Status</th>
                <th className="mas-table-actioncol">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="mas-cell-strong">
                    <span className="mas-cell-stack">
                      <span>{c.title}</span>
                      {c.description && <span className="mas-cell-sub">{c.description}</span>}
                    </span>
                  </td>
                  <td><span className="mas-pill">{kindLabel(c.kind)}</span></td>
                  <td>
                    <span className="mas-cell-stack">
                      <span>{c.state || 'Any'}</span>
                      {c.venue && <span className="mas-cell-sub">{c.venue}</span>}
                    </span>
                  </td>
                  <td>
                    <span className="mas-cell-stack">
                      <span>{prettyDate(c.starts_on)}</span>
                      {c.ends_on && <span className="mas-cell-sub">to {prettyDate(c.ends_on)}</span>}
                    </span>
                  </td>
                  <td className="mas-num">{c.fee != null ? `RM ${Number(c.fee).toFixed(2)}` : '—'}</td>
                  <td>
                    <span className={`mas-outcome ${c.is_published ? 'is-pass' : 'is-refer'}`}>
                      {c.is_published ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td className="mas-table-actioncol">
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {!c.archived_at && (
                        <button className="mas-btn-ghost mas-btn-compact" onClick={() => togglePublish(c)} disabled={busyId === c.id}>
                          {busyId === c.id ? '…' : (c.is_published ? 'Unpublish' : 'Publish')}
                        </button>
                      )}
                      {c.archived_at ? (
                        <button className="mas-btn-ghost mas-btn-compact" onClick={() => setArchived(c, false)} disabled={busyId === c.id}>
                          {busyId === c.id ? '…' : 'Restore'}
                        </button>
                      ) : (
                        <button className="mas-btn-ghost mas-btn-compact" onClick={() => setArchived(c, true)} disabled={busyId === c.id}>
                          {busyId === c.id ? '…' : 'Archive'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
