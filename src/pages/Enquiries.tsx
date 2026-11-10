import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/admin.css';

type Status = 'new' | 'acknowledged' | 'closed' | 'archived';
type Category = 'centre_partnership' | 'instructor_registration' | 'parent_swimmer' | 'general';

interface Enquiry {
  id: string;
  category: Category;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  organisation: string | null;
  state: string | null;
  instructor_ref: string | null;
  affiliated_centre: string | null;
  message: string;
  status: Status;
  assigned_role: string | null;
  handled_at: string | null;
  internal_note: string | null;
  created_at: string;
}

interface ApplicantOption {
  id: string;
  full_name: string;
  email: string;
}

const CAT: Record<Category, { label: string; cls: string }> = {
  centre_partnership:      { label: 'Centre', cls: 'is-primary' },
  instructor_registration: { label: 'Instructor', cls: 'is-purple' },
  parent_swimmer:          { label: 'Parent', cls: 'is-info' },
  general:                 { label: 'General', cls: '' },
};
const STAT: Record<Status, { label: string; cls: string }> = {
  new:          { label: 'New', cls: 'is-warning' },
  acknowledged: { label: 'Acknowledged', cls: 'is-info' },
  closed:       { label: 'Closed', cls: 'is-success' },
  archived:     { label: 'Archived', cls: '' },
};

const FILTERS: { key: Status | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'acknowledged', label: 'In progress' },
  { key: 'closed', label: 'Closed' },
];

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

export default function Enquiries() {
  const [rows, setRows] = useState<Enquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Conversion state — which enquiry is being converted, and applicant search
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [applicantSearch, setApplicantSearch] = useState('');
  const [applicantOptions, setApplicantOptions] = useState<ApplicantOption[]>([]);
  const [applicantSearching, setApplicantSearching] = useState(false);
  const [convertResult, setConvertResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('list_enquiries', { _include_archived: showArchived });
    if (error) { setLoadError(error.message); setRows([]); setLoading(false); return; }
    setLoadError(null);
    setRows((data ?? []) as Enquiry[]);
    setLoading(false);
  }, [showArchived]);

  useEffect(() => { load(); }, [load]);

  async function act(id: string, status: Status) {
    setBusyId(id);
    setActError(null);
    const { error } = await supabase.rpc('set_enquiry_status', { _id: id, _status: status, _note: notes[id] ?? null });
    setBusyId(null);
    if (error) { setActError(error.message); return; }
    load();
  }

  // ---------- Applicant search ----------
  // Fuzzy search across profiles by name or email so the reviewer can pick
  // the account the applicant will use. Applicants must have already signed
  // up (via /claim-signup or a partner sign-up flow) — this doesn't create
  // accounts. If the applicant hasn't signed up yet, the reviewer emails them
  // a signup link first, then comes back here.
  async function searchApplicants(q: string) {
    setApplicantSearch(q);
    if (q.trim().length < 2) { setApplicantOptions([]); return; }
    setApplicantSearching(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(8);
    setApplicantSearching(false);
    if (error) { setApplicantOptions([]); return; }
    setApplicantOptions((data ?? []) as ApplicantOption[]);
  }

  async function convert(enquiryId: string, applicantProfileId: string) {
    setBusyId(enquiryId);
    setConvertResult(null);
    const { error } = await supabase.rpc('convert_enquiry_to_application', {
      _enquiry_id: enquiryId,
      _applicant_profile_id: applicantProfileId,
    });
    setBusyId(null);
    if (error) {
      setConvertResult({ ok: false, text: error.message });
      return;
    }
    setConvertResult({ ok: true, text: 'Converted — the applicant can now fill in their application at /my-application. Send them the link.' });
    setConvertingId(null);
    setApplicantSearch('');
    setApplicantOptions([]);
    load();
  }

  const newCount = rows.filter((r) => r.status === 'new').length;
  const visible = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

  return (
    <section className="mas-page">
      <header className="mas-page-head mas-page-head-row">
        <div>
          <p className="mas-eyebrow">Inbox</p>
          <h1>Enquiries</h1>
          <p className="mas-lede">
            First-contact enquiries routed to you. Reply by email, then acknowledge,
            close, or archive each one here. Archived enquiries have no further effect.
          </p>
        </div>
        <div className="mas-page-actions">
          <button className="mas-btn-ghost" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
        </div>
      </header>

      {newCount > 0 && (
        <div className="mas-alert is-warning">
          <div className="mas-alert-body">
            <p className="mas-alert-title">{newCount} new {newCount === 1 ? 'enquiry' : 'enquiries'}</p>
            <p className="mas-alert-text">Acknowledge each once you’ve picked it up so the team knows it’s being handled.</p>
          </div>
        </div>
      )}

      {convertResult && (
        <div className={`mas-alert ${convertResult.ok ? 'is-success' : 'is-danger'}`}>
          <div className="mas-alert-body">
            <p className="mas-alert-text">{convertResult.text}</p>
          </div>
        </div>
      )}

      <div className="mas-segmented" style={{ marginBottom: '1.25rem' }}>
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={filter === f.key ? 'is-active' : ''} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {actError && <p className="mas-status mas-status-bad">{actError}</p>}
      {!loading && loadError && (
        <p className="mas-status mas-status-bad">Couldn’t load enquiries. Please try again shortly.</p>
      )}
      {loading && <p className="mas-status">Loading…</p>}
      {!loading && visible.length === 0 && <p className="mas-status">Nothing here right now.</p>}

      {!loading && visible.map((e) => {
        const isConvertible = e.category === 'centre_partnership'
          && (e.status === 'new' || e.status === 'acknowledged');
        const isConvertingThis = convertingId === e.id;

        return (
          <div key={e.id} className="mas-form" style={{ marginBottom: '0.9rem' }}>
            <div className="mas-form-cardhead">
              <div>
                <span className={`mas-badge ${CAT[e.category].cls}`}>{CAT[e.category].label}</span>{' '}
                <span className={`mas-badge ${STAT[e.status].cls}`}>{STAT[e.status].label}</span>
                <h2 style={{ marginTop: '0.5rem' }}>{e.organisation || e.contact_name}</h2>
              </div>
              <span className="mas-field-opt">{fmt(e.created_at)}</span>
            </div>

            <div className="mas-form-grid">
              <div className="mas-field">
                <span className="mas-field-label">Contact</span>
                <div>{e.contact_name}</div>
                <a className="mas-link" href={`mailto:${e.contact_email}`}>{e.contact_email}</a>
                {e.contact_phone && <div className="mas-field-note">{e.contact_phone}</div>}
              </div>
              <div className="mas-field">
                {e.state && (<><span className="mas-field-label">State</span><div>{e.state}</div></>)}
                {e.instructor_ref && (<><span className="mas-field-label" style={{ marginTop: '0.5rem' }}>Instructor ID</span><div className="mas-mono">{e.instructor_ref}</div></>)}
                {e.affiliated_centre && (<div className="mas-field-note">Teaches at: {e.affiliated_centre}</div>)}
              </div>
              <div className="mas-field mas-col-2">
                <span className="mas-field-label">Message</span>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{e.message}</p>
              </div>
            </div>

            {e.internal_note && (
              <p className="mas-field-note" style={{ marginTop: '0.5rem' }}>Internal note: {e.internal_note}</p>
            )}

            {e.status !== 'archived' && (
              <div style={{ marginTop: '1rem' }}>
                <input
                  className="mas-input"
                  placeholder="Optional internal note…"
                  value={notes[e.id] ?? ''}
                  onChange={(ev) => setNotes((n) => ({ ...n, [e.id]: ev.target.value }))}
                  style={{ marginBottom: '0.6rem' }}
                />
                <div className="mas-form-actions" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
                  {e.status === 'new' && (
                    <button className="mas-btn-primary" disabled={busyId === e.id} onClick={() => act(e.id, 'acknowledged')}>
                      {busyId === e.id ? 'Saving…' : 'Acknowledge'}
                    </button>
                  )}
                  {e.status === 'acknowledged' && (
                    <button className="mas-btn-success" disabled={busyId === e.id} onClick={() => act(e.id, 'closed')}>
                      {busyId === e.id ? 'Saving…' : 'Mark closed'}
                    </button>
                  )}
                  {isConvertible && !isConvertingThis && (
                    <button
                      className="mas-btn-primary"
                      disabled={busyId === e.id}
                      onClick={() => {
                        setConvertingId(e.id);
                        setConvertResult(null);
                      }}
                    >
                      Convert to partner application →
                    </button>
                  )}
                  <button className="mas-btn-ghost" disabled={busyId === e.id} onClick={() => act(e.id, 'archived')}>
                    Archive
                  </button>
                </div>
              </div>
            )}

            {/* Conversion picker — expanded inline when Convert is clicked */}
            {isConvertingThis && (
              <div style={{
                marginTop: '1rem',
                padding: '1rem 1.2rem',
                background: '#f8fafd',
                borderRadius: '10px',
                border: '1px solid var(--mas-line, #e3e9f3)',
              }}>
                <p style={{ margin: '0 0 0.6rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--mas-navy, #1E2752)' }}>
                  Convert this enquiry into a partner-centre application
                </p>
                <p style={{ margin: '0 0 0.9rem', fontSize: '0.85rem', color: 'var(--mas-muted, #5b6472)', lineHeight: 1.5 }}>
                  Find the applicant’s existing MAS BADGES portal account. Conversion creates a
                  partner-centre stub linked to their profile, plus an empty application row.
                  The applicant then fills in their proposed details at <code>/my-application</code>.
                  If they haven’t signed up yet, email them a signup link first and come back here.
                </p>

                <input
                  type="search"
                  className="mas-input"
                  placeholder="Search applicant by name or email…"
                  value={applicantSearch}
                  onChange={(ev) => searchApplicants(ev.target.value)}
                  style={{ marginBottom: '0.6rem' }}
                />

                {applicantSearching && <p className="mas-status">Searching…</p>}

                {!applicantSearching && applicantOptions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {applicantOptions.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        disabled={busyId === e.id}
                        onClick={() => convert(e.id, o.id)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '0.6rem 0.9rem',
                          background: '#fff',
                          border: '1px solid var(--mas-line, #e3e9f3)',
                          borderRadius: '6px',
                          cursor: busyId === e.id ? 'not-allowed' : 'pointer',
                          font: 'inherit',
                          textAlign: 'left',
                          color: 'var(--mas-navy, #1E2752)',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600 }}>{o.full_name || '(no name)'}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--mas-muted, #5b6472)' }}>{o.email}</div>
                        </div>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                          {busyId === e.id ? 'Converting…' : 'Convert →'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {!applicantSearching && applicantSearch.trim().length >= 2 && applicantOptions.length === 0 && (
                  <p className="mas-field-note">
                    No matching profile. The applicant needs to sign up first — email them
                    a link to <code>{`${window.location.origin}/claim-signup`}</code> or your
                    standard signup URL, then come back here.
                  </p>
                )}

                <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.5rem' }}>
                  <button
                    className="mas-btn-ghost"
                    onClick={() => {
                      setConvertingId(null);
                      setApplicantSearch('');
                      setApplicantOptions([]);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
