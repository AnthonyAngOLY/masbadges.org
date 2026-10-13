import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import '../styles/admin.css';

// #16 reference screen — the dense-table + inline-add + Active/Archived-tabs pattern.
// Candidates use the existing candidate_status enum: 'active' vs 'withdrawn' (the
// archive concept). 'anonymized' records are retention-managed and shown read-only.
// Reads candidates directly via RLS; withdraw/restore via set_candidate_status().

interface CentreOption {
  id: string;
  name: string;
  state: string;
}
interface MyCandidate {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  partner_center_id: string | null;
  status: string;
  created_at: string;
  claim_code: string | null;
  swimmer_id: string | null;
  parent_email: string | null;
}
type Load = 'loading' | 'ready' | 'error';
type Tab = 'active' | 'withdrawn';

const CANDIDATE_COLS =
  'id, full_name, date_of_birth, partner_center_id, status, created_at, claim_code, swimmer_id, parent_email';

function ageFrom(dob: string): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}
function formatDate(d: string | null): string {
  if (!d) return '';
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const CSS = `
.mas-addrow td { background:#f5f8fc; }
.mas-addrow-fields { display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; }
.mas-addrow-fields input[type=text], .mas-addrow-fields input[type=date], .mas-addrow-fields input[type=email], .mas-addrow-fields select {
  font:inherit; padding:0.35rem 0.5rem; border:1px solid var(--mas-line,#e3e9f3); border-radius:6px;
}
.mas-addrow-fields input[type=text] { min-width:12rem; }
.mas-addrow-consent { display:flex; align-items:center; gap:0.35rem; font-size:0.85rem; }
`;

export default function RegisterCandidate() {
  const { session } = useAuth();
  const profileId = session?.user?.id ?? null;

  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [consent, setConsent] = useState(false);

  const [centres, setCentres] = useState<CentreOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);

  const [mine, setMine] = useState<MyCandidate[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [tab, setTab] = useState<Tab>('active');
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const centreName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of centres) map[c.id] = c.name;
    return map;
  }, [centres]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('partner_center_directory')
        .select('id, name, state')
        .order('name');
      if (error) { console.error('partner_center_directory load failed:', error.message); return; }
      if (!cancelled) setCentres((data ?? []) as CentreOption[]);
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchMine = useCallback(async () => {
    if (!profileId) return;
    setLoad('loading');
    const { data, error } = await supabase
      .from('candidates')
      .select(CANDIDATE_COLS)
      .eq('registered_by_profile_id', profileId)
      .order('created_at', { ascending: false });
    if (error) {
      setLoad('error');
      return;
    }
    setMine((data ?? []) as MyCandidate[]);
    setLoad('ready');
  }, [profileId]);

  useEffect(() => {
    fetchMine();
  }, [fetchMine]);

  const age = ageFrom(dob);
  const canSubmit =
    fullName.trim().length > 1 && !!dob && consent && !submitting && !!profileId;

  async function submit() {
    if (!canSubmit || !profileId) return;
    setSubmitting(true);
    setFormError(null);
    setJustAdded(null);
    // Instructor + centre are locked together server-side: the registrant is
    // auto-tagged and the centre is derived from their own membership.
    const { data, error } = await supabase.rpc('register_candidate', {
      _full_name: fullName.trim(),
      _dob: dob,
      _consent: consent,
      _parent_email: parentEmail.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as MyCandidate | null;
    if (row) {
      setMine((list) => [row, ...list]);
      setJustAdded(row.full_name);
      setLastCode(row.claim_code);
    }
    setFullName('');
    setDob('');
    setParentEmail('');
    setConsent(false);
  }

  async function setStatus(c: MyCandidate, status: 'active' | 'withdrawn') {
    setBusy(c.id);
    setRowError((m) => { const n = { ...m }; delete n[c.id]; return n; });
    const { error } = await supabase.rpc('set_candidate_status', {
      _candidate_id: c.id,
      _status: status,
    });
    setBusy(null);
    if (error) {
      setRowError((m) => ({ ...m, [c.id]: error.message }));
      return;
    }
    setMine((list) => list.map((x) => (x.id === c.id ? { ...x, status } : x)));
  }

  const counts = useMemo(() => ({
    active: mine.filter((c) => c.status === 'active').length,
    withdrawn: mine.filter((c) => c.status === 'withdrawn' || c.status === 'anonymized').length,
  }), [mine]);

  const filtered = useMemo(
    () => mine.filter((c) =>
      tab === 'active' ? c.status === 'active' : c.status === 'withdrawn' || c.status === 'anonymized'),
    [mine, tab],
  );

  return (
    <section className="mas-page">
      <style>{CSS}</style>
      <header className="mas-page-head">
        <p className="mas-eyebrow">Instructor</p>
        <h1>Register a candidate</h1>
        <p className="mas-lede">
          Create a record for a child (typically aged 5–12) you are preparing for assessment.
          Add one in the top row. Only the minimum identifying details are stored.
        </p>
      </header>

      <div className="mas-admin-toolbar" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
        <button className="mas-btn-ghost" onClick={fetchMine} disabled={load === 'loading'}>
          Refresh
        </button>
        <div className="mas-tabs" role="tablist" style={{ display: 'flex', gap: '0.3rem' }}>
          <button role="tab" aria-selected={tab === 'active'}
            className={tab === 'active' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => setTab('active')}>
            Active ({counts.active})
          </button>
          <button role="tab" aria-selected={tab === 'withdrawn'}
            className={tab === 'withdrawn' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => setTab('withdrawn')}>
            Withdrawn ({counts.withdrawn})
          </button>
        </div>
      </div>

      {justAdded && !formError && (
        <p className="mas-status mas-status-good" role="status">
          “{justAdded}” registered.
          {lastCode && (<>{' '}Give the parent this claim code:{' '}<span className="mas-serial">{lastCode}</span></>)}
        </p>
      )}
      {formError && (
        <p className="mas-status mas-status-bad">Couldn’t register this candidate: {formError}</p>
      )}

      <div className="mas-table-wrap">
        <table className="mas-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Date of birth</th>
              <th>Centre</th>
              <th>Swimmer ID</th>
              <th>Claim code</th>
              <th className="mas-table-actioncol">Action</th>
            </tr>
          </thead>
          <tbody>
            {/* Inline add-row (only on the Active tab) */}
            {tab === 'active' && (
              <tr className="mas-addrow">
                <td colSpan={6}>
                  <div className="mas-addrow-fields">
                    <input
                      type="text" value={fullName} autoComplete="off"
                      placeholder="Child’s full name"
                      onChange={(e) => setFullName(e.target.value)}
                    />
                    <input
                      type="date" value={dob}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setDob(e.target.value)}
                    />
                    <input
                      type="email" value={parentEmail} autoComplete="off"
                      placeholder="Parent email (optional)"
                      onChange={(e) => setParentEmail(e.target.value)}
                      style={{ minWidth: '14rem' }}
                    />
                    <label className="mas-addrow-consent">
                      <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                      <span>Parent/guardian consent given</span>
                    </label>
                    <button className="mas-btn-primary mas-btn-compact" onClick={submit} disabled={!canSubmit}>
                      {submitting ? 'Adding…' : '+ Add'}
                    </button>
                    {age !== null && (age < 5 || age > 12) && (
                      <span className="mas-cell-sub">{age} yrs — outside 5–12, still allowed</span>
                    )}
                  </div>
                </td>
              </tr>
            )}

            {load === 'ready' && filtered.length === 0 && (
              <tr><td colSpan={6} className="mas-status">
                {tab === 'active' ? 'No active candidates yet.' : 'No withdrawn candidates.'}
              </td></tr>
            )}

            {filtered.map((c) => (
              <tr key={c.id}>
                <td className="mas-cell-strong">
                  <span className="mas-cell-stack">
                    <span>
                      {c.full_name}
                      {c.status === 'anonymized' && <span className="mas-pill" style={{ marginLeft: '0.4rem' }}>anonymized</span>}
                    </span>
                    {c.parent_email && <span className="mas-cell-sub">{c.parent_email}</span>}
                  </span>
                </td>
                <td>{formatDate(c.date_of_birth) || '—'}</td>
                <td>{c.partner_center_id ? (centreName[c.partner_center_id] ?? 'Centre') : 'Independent'}</td>
                <td className="mas-cell-strong">{c.swimmer_id ?? '—'}</td>
                <td>{c.claim_code ? <span className="mas-serial">{c.claim_code}</span> : '—'}</td>
                <td className="mas-table-actioncol">
                  {c.status === 'anonymized' ? (
                    <span className="mas-cell-sub">—</span>
                  ) : c.status === 'withdrawn' ? (
                    <button className="mas-btn-ghost mas-btn-compact" onClick={() => setStatus(c, 'active')} disabled={busy === c.id}>
                      {busy === c.id ? '…' : 'Restore'}
                    </button>
                  ) : (
                    <button className="mas-btn-ghost mas-btn-compact" onClick={() => setStatus(c, 'withdrawn')} disabled={busy === c.id}>
                      {busy === c.id ? '…' : 'Withdraw'}
                    </button>
                  )}
                  {rowError[c.id] && <span className="mas-status mas-status-bad">{rowError[c.id]}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {load === 'loading' && <p className="mas-status">Loading…</p>}
      {load === 'error' && <p className="mas-status mas-status-bad">Couldn’t load your candidates.</p>}
    </section>
  );
}
