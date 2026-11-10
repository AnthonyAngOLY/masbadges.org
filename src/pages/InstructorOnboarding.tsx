import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/admin.css';

interface CentreRow { id: string; name: string; }
interface Invitation {
  id: string;
  email: string;
  full_name: string | null;
  partner_center_id: string | null;
  centre_name: string | null;
  status: string;
  created_at: string;
  redeemed_at: string | null;
}

type Load = 'loading' | 'ready' | 'error';

function pretty(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
function statusClass(s: string): string {
  return s === 'redeemed' ? 'is-pass' : s === 'revoked' ? 'is-refer' : '';
}

export default function InstructorOnboarding() {
  const [centres, setCentres] = useState<CentreRow[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [load, setLoad] = useState<Load>('loading');

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [centreId, setCentreId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchInvitations = useCallback(async () => {
    setLoad('loading');
    const { data, error } = await supabase.rpc('list_instructor_invitations');
    if (error) {
      setLoad('error');
      return;
    }
    setInvitations((data ?? []) as Invitation[]);
    setLoad('ready');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('partner_centers').select('id, name').order('name');
      if (error) { console.error('partner_centers load failed:', error.message); return; }
      if (!cancelled) setCentres((data ?? []) as CentreRow[]);
    })();
    fetchInvitations();
    return () => { cancelled = true; };
  }, [fetchInvitations]);

  const canInvite = !!email.trim() && !busy;

  async function invite() {
    if (!canInvite) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    const { data, error } = await supabase.rpc('invite_instructor', {
      _email: email.trim(),
      _full_name: fullName.trim() || null,
      _center_id: centreId || null,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNotice(
      data === 'granted'
        ? 'That account already existed — the instructor role was granted immediately.'
        : 'Invitation recorded. The instructor role will be granted automatically when they sign up with this email.',
    );
    setEmail('');
    setFullName('');
    setCentreId('');
    fetchInvitations();
  }

  async function revoke(id: string) {
    setBusyId(id);
    const { error } = await supabase.rpc('revoke_instructor_invitation', { _id: id });
    setBusyId(null);
    if (error) {
      setError(error.message);
      return;
    }
    fetchInvitations();
  }

  return (
    <section className="mas-page">
      <header className="mas-page-head">
        <p className="mas-eyebrow">Administration</p>
        <h1>Instructor onboarding</h1>
        <p className="mas-lede">
          Invite a certified instructor by email. If they already have an
          account they’re granted the instructor role now; otherwise it’s granted
          automatically the moment they sign up with that email.
        </p>
      </header>

      <div className="mas-form">
        <div className="mas-field">
          <label htmlFor="email" className="mas-field-label">Email</label>
          <input
            id="email"
            className="mas-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="instructor@example.com"
          />
        </div>
        <div className="mas-field">
          <label htmlFor="name" className="mas-field-label">Full name (optional)</label>
          <input
            id="name"
            className="mas-input"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="mas-field">
          <label htmlFor="centre" className="mas-field-label">Centre (optional)</label>
          <select id="centre" className="mas-select" value={centreId} onChange={(e) => setCentreId(e.target.value)}>
            <option value="">No centre</option>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <p className="mas-field-note">Links the instructor to a partner centre, if applicable.</p>
        </div>

        {error && <p className="mas-status mas-status-bad">{error}</p>}
        {notice && <p className="mas-status mas-status-good">{notice}</p>}

        <div className="mas-form-actions">
          <button className="mas-btn-primary" onClick={invite} disabled={!canInvite}>
            {busy ? 'Inviting…' : 'Invite instructor'}
          </button>
        </div>
      </div>

      <header className="mas-page-head mas-section-head">
        <h2>Invitations</h2>
      </header>

      <div className="mas-admin-toolbar">
        <button className="mas-btn-ghost" onClick={fetchInvitations} disabled={load === 'loading'}>Refresh</button>
        {load === 'ready' && <span className="mas-admin-count">{invitations.length} total</span>}
      </div>

      {load === 'loading' && <p className="mas-status">Loading…</p>}
      {load === 'error' && <p className="mas-status mas-status-bad">Couldn’t load invitations.</p>}
      {load === 'ready' && invitations.length === 0 && (
        <p className="mas-status">No invitations yet.</p>
      )}

      {load === 'ready' && invitations.length > 0 && (
        <ul className="mas-admin-list">
          {invitations.map((inv) => (
            <li key={inv.id} className="mas-admin-row">
              <div className="mas-admin-main">
                <h3 className="mas-admin-name">{inv.full_name || inv.email}</h3>
                <p className="mas-admin-meta">
                  <span className={`mas-outcome ${statusClass(inv.status)}`}>{pretty(inv.status)}</span>
                  <span className="mas-admin-sub">
                    {inv.email}
                    {inv.centre_name ? ` · ${inv.centre_name}` : ''}
                    {` · invited ${inv.created_at.slice(0, 10)}`}
                  </span>
                </p>
              </div>
              <div className="mas-admin-action">
                {inv.status === 'pending' && (
                  <button className="mas-btn-ghost" onClick={() => revoke(inv.id)} disabled={busyId === inv.id}>
                    {busyId === inv.id ? '…' : 'Revoke'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
