// #19 — Parent dashboard.
//
// Landing surface after email confirmation and for signed-in parents. Reads:
//   list_my_claimed_swimmers()               → cards
//   list_swimmer_tracker(_candidate_id)      → per-swimmer active-session bar
//   list_swimmer_certificates(_candidate_id) → per-swimmer cert list (reuses #17)
//   claim_candidate(_code)                   → add another child
//
// Layout: one card per claimed swimmer with an expandable certificate list and
// an inline six-checkpoint bar when a session is active. Bottom of page:
// "Add another child — enter claim code" input.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import '../styles/admin.css';

interface Swimmer {
  candidate_id: string;
  full_name: string;
  date_of_birth: string | null;
  swimmer_id: string | null;
  status: string;
  highest_level: string | null;
  highest_level_on: string | null;
  cert_count: number;
}
interface Cert {
  id: string;
  serial: string;
  level: string;
  issued_on: string;
}
interface Tracker {
  session_id: string;
  venue: string | null;
  state: string | null;
  scheduled_on: string | null;
  status: string;
  booked_level: string;
  cp_created: boolean;
  cp_roster: boolean;
  cp_paid: boolean;
  cp_examiner: boolean;
  cp_completed: boolean;
  cp_certs: boolean;
}
type Load = 'loading' | 'ready' | 'error';

function pretty(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Parent-view checkpoint labels — deliberately softer than the instructor-facing
// labels ("Payment cleared" → "Awaiting clearance / Cleared").
function trackerSteps(t: Tracker) {
  return [
    { done: t.cp_created,   label: 'Session created' },
    { done: t.cp_roster,    label: 'Roster confirmed' },
    { done: t.cp_paid,      label: t.cp_paid ? 'Cleared' : 'Awaiting clearance' },
    { done: t.cp_examiner,  label: 'Examiner assigned' },
    { done: t.cp_completed, label: 'Assessment complete' },
    { done: t.cp_certs,     label: 'Certificates issued' },
  ];
}

const CSS = `
.mas-parent-card {
  border:1px solid var(--mas-line,#e3e9f3); border-radius:12px;
  padding:1rem 1.1rem; margin-bottom:1rem; background:#fff;
}
.mas-parent-cardhead { display:flex; align-items:baseline; gap:0.6rem; flex-wrap:wrap; }
.mas-parent-cardhead h2 { margin:0; font-size:1.15rem; color:var(--mas-navy,#1E2752); }
.mas-parent-cardhead .sub { color:var(--mas-muted,#5b6472); font-size:0.9rem; }
.mas-parent-badge {
  background:var(--mas-yellow,#F9C610); color:var(--mas-navy,#1E2752);
  padding:0.2rem 0.5rem; border-radius:6px; font-weight:700; font-size:0.85rem;
  text-transform:uppercase; letter-spacing:0.5px;
}
.mas-parent-section { margin-top:0.9rem; }
.mas-parent-section h3 {
  font-family:'Barlow Condensed',Arial,sans-serif; font-weight:800;
  text-transform:uppercase; letter-spacing:.5px; font-size:0.85rem;
  color:var(--mas-navy,#1E2752); margin:0 0 0.4rem;
}
.mas-cert-mini {
  display:flex; align-items:center; gap:0.6rem; padding:0.4rem 0;
  border-top:1px solid var(--mas-line,#e3e9f3);
}
.mas-cert-mini:first-of-type { border-top:none; }
.mas-cp-bar { display:flex; gap:0.35rem; flex-wrap:wrap; margin-top:0.3rem; }
.mas-cp {
  display:flex; flex-direction:column; align-items:center; gap:0.25rem;
  padding:0.3rem 0.5rem; border-radius:6px; background:#f5f8fc; min-width:5.5rem;
}
.mas-cp.done { background:#e6f4ea; }
.mas-cp .dot {
  width:0.8rem; height:0.8rem; border-radius:50%;
  background:#c9d3e0;
}
.mas-cp.done .dot { background:#2f8a3e; }
.mas-cp .label { font-size:0.72rem; color:var(--mas-navy,#1E2752); text-align:center; }
.mas-claim-panel {
  background:#f5f8fc; border:1px solid var(--mas-line,#e3e9f3); border-radius:10px;
  padding:0.8rem 0.9rem; margin-top:1.5rem;
}
.mas-claim-panel h3 {
  font-family:'Barlow Condensed',Arial,sans-serif; font-weight:800;
  text-transform:uppercase; letter-spacing:.5px; font-size:0.95rem;
  color:var(--mas-navy,#1E2752); margin:0 0 0.4rem;
}
.mas-claim-row { display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; }
.mas-claim-row input {
  font:inherit; padding:0.4rem 0.6rem; border:1px solid var(--mas-line,#e3e9f3); border-radius:6px;
  min-width:14rem; font-family:'Courier New',monospace; letter-spacing:1px; text-transform:uppercase;
}
`;

export default function ParentDashboard() {
  const { user } = useAuth();
  const displayName = (user?.user_metadata?.full_name as string | undefined) || user?.email || 'there';

  const [swimmers, setSwimmers] = useState<Swimmer[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [certs, setCerts] = useState<Record<string, Cert[]>>({});
  const [certsError, setCertsError] = useState<Record<string, string>>({});
  const [tracker, setTracker] = useState<Record<string, Tracker | null>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [code, setCode] = useState('');
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimOk, setClaimOk] = useState<string | null>(null);

  const fetchSwimmers = useCallback(async () => {
    setLoad('loading');
    const { data, error } = await supabase.rpc('list_my_claimed_swimmers');
    if (error) { setLoad('error'); return; }
    const rows = (data ?? []) as Swimmer[];
    setSwimmers(rows);
    setLoad('ready');
    // For each swimmer, load their tracker eagerly (parents want to see progress at a glance).
    rows.forEach(async (s) => {
      const { data: t, error: tErr } = await supabase.rpc('list_swimmer_tracker', { _candidate_id: s.candidate_id });
      // Progress is a nice-to-have next to the certificate list, so a failure
      // here leaves it absent rather than blocking the page — but it is logged
      // instead of silently looking like "no progress recorded".
      if (tErr) { console.error('list_swimmer_tracker failed:', tErr.message); return; }
      const row = (Array.isArray(t) ? t[0] : t) as Tracker | null;
      setTracker((m) => ({ ...m, [s.candidate_id]: row ?? null }));
    });
  }, []);

  useEffect(() => { fetchSwimmers(); }, [fetchSwimmers]);

  async function toggleCerts(candidateId: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(candidateId)) n.delete(candidateId);
      else n.add(candidateId);
      return n;
    });
    if (!certs[candidateId]) {
      const { data, error } = await supabase.rpc('list_swimmer_certificates', { _candidate_id: candidateId });
      if (error) {
        // The button says "Show N certificates", so an empty list after a failed
        // fetch would read as the child's certificates having vanished.
        setCertsError((m) => ({ ...m, [candidateId]: error.message }));
        return;
      }
      setCertsError((m) => { const n = { ...m }; delete n[candidateId]; return n; });
      setCerts((m) => ({ ...m, [candidateId]: (data ?? []) as Cert[] }));
    }
  }

  async function addClaim() {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setClaimBusy(true); setClaimError(null); setClaimOk(null);
    const { data, error } = await supabase.rpc('claim_candidate', { _code: c });
    setClaimBusy(false);
    if (error) { setClaimError(error.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      setClaimError('That code isn’t valid or has already been used.');
      return;
    }
    setClaimOk(`Added ${row.full_name}!`);
    setCode('');
    fetchSwimmers();
  }

  return (
    <section className="mas-page">
      <style>{CSS}</style>
      <header className="mas-page-head">
        <p className="mas-eyebrow">Parent</p>
        <h1>Your children</h1>
        <p className="mas-lede">
          Welcome, {displayName}. Below are the swimmers linked to your account, their
          badges, and any assessment currently in progress.
        </p>
      </header>

      {load === 'loading' && <p className="mas-status">Loading…</p>}
      {load === 'error' && <p className="mas-status mas-status-bad">Couldn’t load your dashboard. Refresh to try again.</p>}
      {load === 'ready' && swimmers.length === 0 && (
        <p className="mas-status">
          You haven’t claimed any children yet. Enter a claim code below to link one.
        </p>
      )}

      {swimmers.map((s) => {
        const t = tracker[s.candidate_id];
        const isOpen = expanded.has(s.candidate_id);
        return (
          <article key={s.candidate_id} className="mas-parent-card">
            <div className="mas-parent-cardhead">
              <h2>{s.full_name}</h2>
              <span className="sub">
                {fmtDate(s.date_of_birth)}
                {s.swimmer_id ? ` · ${s.swimmer_id}` : ''}
              </span>
              {s.highest_level ? (
                <span className="mas-parent-badge">{pretty(s.highest_level)}</span>
              ) : (
                <span className="sub">No badges yet</span>
              )}
            </div>

            {t && (
              <div className="mas-parent-section">
                <h3>Assessment in progress · {pretty(t.booked_level)}</h3>
                <p className="sub" style={{ margin: '0.2rem 0 0.4rem' }}>
                  {t.venue || pretty(t.state) || 'venue tbc'} · {fmtDate(t.scheduled_on)}
                </p>
                <div className="mas-cp-bar">
                  {trackerSteps(t).map((step, idx) => (
                    <div key={idx} className={`mas-cp${step.done ? ' done' : ''}`}>
                      <span className="dot" />
                      <span className="label">{step.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mas-parent-section">
              <h3>Certificates ({s.cert_count})</h3>
              {s.cert_count === 0 ? (
                <p className="sub" style={{ margin: 0 }}>No certificates released yet.</p>
              ) : (
                <>
                  <button className="mas-btn-ghost mas-btn-compact" onClick={() => toggleCerts(s.candidate_id)}>
                    {isOpen ? 'Hide list' : `Show ${s.cert_count} certificate${s.cert_count === 1 ? '' : 's'}`}
                  </button>
                  {isOpen && certsError[s.candidate_id] && (
                    <p className="mas-status mas-status-bad">
                      Couldn’t load these certificates. Please try again shortly.
                    </p>
                  )}
                  {isOpen && !certsError[s.candidate_id] && (certs[s.candidate_id] ?? []).length > 0 && (
                    <div style={{ marginTop: '0.5rem' }}>
                      {(certs[s.candidate_id] ?? []).map((c) => (
                        <div key={c.id} className="mas-cert-mini">
                          <span className="mas-parent-badge">{pretty(c.level)}</span>
                          <span className="sub">{fmtDate(c.issued_on)}</span>
                          <span className="mas-serial">{c.serial}</span>
                          <Link to={`/certificate/${c.serial}`} style={{ marginLeft: 'auto' }}>View</Link>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </article>
        );
      })}

      <div className="mas-claim-panel">
        <h3>Add another child</h3>
        <p className="sub" style={{ margin: '0 0 0.6rem' }}>
          If you’ve been given a claim code for another swimmer, enter it here.
        </p>
        <div className="mas-claim-row">
          <input
            type="text" value={code} autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Claim code"
            onKeyDown={(e) => { if (e.key === 'Enter') addClaim(); }}
          />
          <button className="mas-btn-primary mas-btn-compact" onClick={addClaim} disabled={claimBusy || !code.trim()}>
            {claimBusy ? 'Adding…' : '+ Add child'}
          </button>
        </div>
        {claimError && <p className="mas-status mas-status-bad" style={{ marginTop: '0.4rem' }}>{claimError}</p>}
        {claimOk && <p className="mas-status mas-status-good" style={{ marginTop: '0.4rem' }}>{claimOk}</p>}
      </div>
    </section>
  );
}
