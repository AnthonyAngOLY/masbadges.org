import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import '../styles/admin.css';

interface Child {
  id: string;
  full_name: string;
  date_of_birth: string | null;
}
interface Cert {
  id: string;
  serial: string;
  level: string;
  issued_on: string;
  candidate_id: string;
}

type Load = 'loading' | 'ready' | 'error';

function prettyLevel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function ClaimCandidate() {
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [code, setCode] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimedName, setClaimedName] = useState<string | null>(null);

  const [children, setChildren] = useState<Child[]>([]);
  const [certs, setCerts] = useState<Record<string, Cert[]>>({});
  const [certsFailed, setCertsFailed] = useState(false);
  const [load, setLoad] = useState<Load>('loading');

  const fetchChildren = useCallback(async () => {
    if (!me) return;
    setLoad('loading');
    const { data: kids, error } = await supabase
      .from('candidates')
      .select('id, full_name, date_of_birth')
      .eq('claimed_by_profile_id', me)
      .order('full_name');
    if (error) {
      setLoad('error');
      return;
    }
    const list = (kids ?? []) as Child[];
    setChildren(list);

    if (list.length > 0) {
      const ids = list.map((k) => k.id);
      const { data: cert, error: certError } = await supabase
        .from('certificates')
        .select('id, serial, level, issued_on, candidate_id')
        .in('candidate_id', ids)
        .order('issued_on', { ascending: false });
      // Otherwise a failed fetch renders as "No badges awarded yet." to a parent
      // whose child has badges.
      setCertsFailed(Boolean(certError));
      const byChild: Record<string, Cert[]> = {};
      for (const c of (cert ?? []) as Cert[]) (byChild[c.candidate_id] ??= []).push(c);
      setCerts(byChild);
    } else {
      setCerts({});
    }
    setLoad('ready');
  }, [me]);

  useEffect(() => {
    fetchChildren();
  }, [fetchChildren]);

  async function claim() {
    if (!code.trim()) return;
    setClaiming(true);
    setClaimError(null);
    setClaimedName(null);

    const { data, error } = await supabase.rpc('claim_candidate', {
      _code: code.trim(),
    });
    setClaiming(false);

    if (error) {
      setClaimError(error.message);
      return;
    }
    const row = (data ?? [])[0] as { candidate_id: string; full_name: string } | undefined;
    setClaimedName(row?.full_name ?? 'your child');
    setCode('');
    fetchChildren();
  }

  return (
    <section className="mas-page">
      <header className="mas-page-head">
        <p className="mas-eyebrow">Parents &amp; guardians</p>
        <h1>My child’s badges</h1>
        <p className="mas-lede">
          Enter the claim code your swim centre gave you to link your child to
          your account and see their badges.
        </p>
      </header>

      <div className="mas-form mas-page-narrow">
        <div className="mas-field">
          <label htmlFor="code" className="mas-field-label">Claim code</label>
          <input
            id="code"
            className="mas-input"
            type="text"
            value={code}
            onChange={(e) => { setCode(e.target.value); setClaimedName(null); setClaimError(null); }}
            placeholder="e.g. 4F9A2C7B10"
            autoComplete="off"
            style={{ textTransform: 'uppercase' }}
          />
        </div>

        {claimError && <p className="mas-status mas-status-bad">{claimError}</p>}
        {claimedName && (
          <p className="mas-status mas-status-good">
            {claimedName} is now linked to your account.
          </p>
        )}

        <div className="mas-form-actions">
          <button className="mas-btn-primary" onClick={claim} disabled={claiming || !code.trim()}>
            {claiming ? 'Claiming…' : 'Claim'}
          </button>
        </div>
      </div>

      <header className="mas-page-head mas-section-head">
        <h2>Your children</h2>
      </header>

      {load === 'loading' && <p className="mas-status">Loading…</p>}
      {load === 'error' && <p className="mas-status mas-status-bad">Couldn’t load your children.</p>}
      {load === 'ready' && children.length === 0 && (
        <p className="mas-status">No children linked yet — claim one with a code above.</p>
      )}

      {load === 'ready' &&
        children.map((child) => {
          const list = certs[child.id] ?? [];
          return (
            <div key={child.id} className="mas-grade-session">
              <div className="mas-grade-session-head">
                <h3 className="mas-admin-name">{child.full_name}</h3>
              </div>
              {certsFailed ? (
                <p className="mas-status mas-status-bad">
                  Couldn’t load badges just now. Please try again shortly.
                </p>
              ) : list.length === 0 ? (
                <p className="mas-status">No badges awarded yet.</p>
              ) : (
                <ul className="mas-admin-list">
                  {list.map((cert) => (
                    <li key={cert.id} className="mas-admin-row">
                      <div className="mas-admin-main">
                        <h4 className="mas-admin-name">{prettyLevel(cert.level)}</h4>
                        <p className="mas-admin-meta">
                          <span className="mas-admin-sub">Awarded {cert.issued_on}</span>
                        </p>
                        <p className="mas-admin-line">
                          <span className="mas-serial">{cert.serial}</span> ·{' '}
                          <Link to={`/verify/${cert.serial}`}>verify</Link>
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
    </section>
  );
}
