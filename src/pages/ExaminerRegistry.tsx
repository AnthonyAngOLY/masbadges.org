// #16 — Examiner registry, dense-table conversion.
//   list   ← list_examiner_invitations(_include_revoked)
//   invite ← onboard_examiner(_email, _state)          → returns new examiner UID
//   revoke ← revoke_examiner_invitation(_id)
// House law: dense table · Active/Revoked tabs · inline-add row (email · state · +Invite).
// Tabs replace the old "Show revoked" toggle — fetches with _include_revoked=true so
// both sets are in memory and switching is instant.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/admin.css';

interface StateRow { state: string; }
interface Invite {
  id: string;
  email: string;
  examiner_uid: string;
  state: string;
  status: string;
  invited_at: string;
  accepted_at: string | null;
  accepted_person: string | null;
}

type Load = 'loading' | 'ready' | 'error';
type Tab = 'active' | 'revoked';

const STAT: Record<string, { label: string; cls: string }> = {
  pending:  { label: 'Awaiting registration', cls: 'is-refer' },
  accepted: { label: 'Registered', cls: 'is-pass' },
  revoked:  { label: 'Revoked', cls: '' },
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

const CSS = `
.mas-addrow td { background:#f5f8fc; }
.mas-addrow-fields { display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; }
.mas-addrow-fields input[type=email], .mas-addrow-fields select {
  font:inherit; padding:0.35rem 0.5rem; border:1px solid var(--mas-line,#e3e9f3); border-radius:6px;
}
.mas-addrow-fields input[type=email] { min-width:16rem; }
`;

export default function ExaminerRegistry() {
  const [states, setStates] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [state, setState] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [lastUid, setLastUid] = useState<string | null>(null);

  const [rows, setRows] = useState<Invite[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [tab, setTab] = useState<Tab>('active');
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const loadRows = useCallback(async () => {
    setLoad('loading');
    // fetch WITH revoked so tabs switch without a refetch
    const { data, error } = await supabase.rpc('list_examiner_invitations', { _include_revoked: true });
    if (error) { setLoad('error'); return; }
    setRows((data ?? []) as Invite[]);
    setLoad('ready');
  }, []);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('list_states');
      if (error) { console.error('list_states failed:', error.message); return; }
      setStates(((data ?? []) as StateRow[]).map((x) => x.state));
    })();
    loadRows();
  }, [loadRows]);

  const canInvite = email.includes('@') && !!state && !busy;

  async function invite() {
    if (!canInvite) return;
    setBusy(true); setInviteError(null); setLastUid(null);
    const { data, error } = await supabase.rpc('onboard_examiner', { _email: email, _state: state });
    setBusy(false);
    if (error) { setInviteError(error.message); return; }
    setLastUid(data as string);
    setEmail(''); setState('');
    loadRows();
  }

  async function revoke(id: string) {
    setBusyRow(id);
    setRowError((m) => { const n = { ...m }; delete n[id]; return n; });
    const { error } = await supabase.rpc('revoke_examiner_invitation', { _id: id });
    setBusyRow(null);
    if (error) {
      setRowError((m) => ({ ...m, [id]: error.message }));
      return;
    }
    loadRows();
  }

  const counts = useMemo(() => ({
    active: rows.filter((r) => r.status !== 'revoked').length,
    revoked: rows.filter((r) => r.status === 'revoked').length,
  }), [rows]);

  const filtered = useMemo(
    () => rows.filter((r) => (tab === 'active' ? r.status !== 'revoked' : r.status === 'revoked')),
    [rows, tab],
  );

  return (
    <section className="mas-page">
      <style>{CSS}</style>
      <header className="mas-page-head">
        <p className="mas-eyebrow">Chief Examiner</p>
        <h1>Examiner registry</h1>
        <p className="mas-lede">
          Examiners are appointed internally. Invite one in the top row — their unique
          examiner UID is generated on invitation; the examiner role activates when they
          register with the invited email.
        </p>
      </header>

      <div className="mas-admin-toolbar" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
        <button className="mas-btn-ghost" onClick={loadRows} disabled={load === 'loading'}>
          Refresh
        </button>
        <div className="mas-tabs" role="tablist" style={{ display: 'flex', gap: '0.3rem' }}>
          <button role="tab" aria-selected={tab === 'active'}
            className={tab === 'active' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => setTab('active')}>Active ({counts.active})</button>
          <button role="tab" aria-selected={tab === 'revoked'}
            className={tab === 'revoked' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => setTab('revoked')}>Revoked ({counts.revoked})</button>
        </div>
      </div>

      {lastUid && (
        <p className="mas-status mas-status-good" role="status">
          Invitation created · UID <span className="mas-serial">{lastUid}</span>. Ask the
          examiner to register with the invited email; their role activates on first login.
        </p>
      )}
      {inviteError && (
        <p className="mas-status mas-status-bad">Couldn’t create invitation: {inviteError}</p>
      )}

      <div className="mas-table-wrap">
        <table className="mas-table">
          <thead>
            <tr>
              <th>Examiner UID</th>
              <th>Email / Person</th>
              <th>State</th>
              <th>Status</th>
              <th>Invited</th>
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
                      type="email" value={email} autoComplete="off"
                      placeholder="Examiner email"
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <select value={state} onChange={(e) => setState(e.target.value)}>
                      <option value="">Select a state…</option>
                      {states.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button className="mas-btn-primary mas-btn-compact" onClick={invite} disabled={!canInvite}>
                      {busy ? 'Inviting…' : '+ Invite'}
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {load === 'loading' && (
              <tr><td colSpan={6} className="mas-status">Loading…</td></tr>
            )}
            {load === 'error' && (
              <tr><td colSpan={6} className="mas-status mas-status-bad">Couldn’t load invitations. Refresh to try again.</td></tr>
            )}
            {load === 'ready' && filtered.length === 0 && (
              <tr><td colSpan={6} className="mas-status">
                {tab === 'active' ? 'No active examiners yet.' : 'No revoked invitations.'}
              </td></tr>
            )}

            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="mas-cell-strong mas-serial">{r.examiner_uid}</td>
                <td>
                  <span className="mas-cell-stack">
                    <span>{r.accepted_person || r.email}</span>
                    {r.accepted_person && <span className="mas-cell-sub">{r.email}</span>}
                  </span>
                </td>
                <td><span className="mas-pill">{r.state}</span></td>
                <td>
                  <span className={`mas-outcome ${STAT[r.status]?.cls ?? ''}`}>
                    {STAT[r.status]?.label ?? r.status}
                  </span>
                </td>
                <td>{fmt(r.invited_at)}</td>
                <td className="mas-table-actioncol">
                  {r.status === 'pending' && (
                    <button className="mas-btn-ghost mas-btn-compact" onClick={() => revoke(r.id)} disabled={busyRow === r.id}>
                      {busyRow === r.id ? '…' : 'Revoke'}
                    </button>
                  )}
                  {rowError[r.id] && <span className="mas-status mas-status-bad">{rowError[r.id]}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
