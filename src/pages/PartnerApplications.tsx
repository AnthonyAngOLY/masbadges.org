// Reviewer surface for partner-centre applications. Extended from the original
// to display all proposed_* fields the applicant submitted, and to grant
// teaching and assessment recognition independently through
// decide_partner_application_split.
//
// Original behaviour preserved:
//   • Attention alert for centres without an active instructor
//   • Acknowledge action for 'submitted' status
//   • Legacy single-decision Deny (deny full application)
// New behaviour:
//   • Expand row → full proposed_* detail: blurb, structured address, photos,
//     public contact, operating hours, pool spec + safety
//   • Two independent grant buttons: "Grant teaching" and "Grant assessment"
//   • Live badges for what's already been granted
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/admin.css';

interface AppRow {
  id: string;
  partner_center_id: string;
  centre_name: string;
  state: string;
  poc_name: string | null;
  poc_email: string;
  poc_phone: string | null;
  submitted_by: string | null;
  status: string;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  requested_can_teach: boolean;
  requested_can_assess: boolean;
  can_teach_now: boolean;
  can_assess_now: boolean;
  proposed_public_blurb: string | null;
  proposed_address_line1: string | null;
  proposed_address_line2: string | null;
  proposed_city: string | null;
  proposed_postcode: string | null;
  proposed_google_maps_url: string | null;
  proposed_public_email: string | null;
  proposed_public_phone: string | null;
  proposed_hours_text: string | null;
  proposed_image_paths: string[];
  proposed_pool_length_m: number | null;
  proposed_pool_min_depth_m: number | null;
  proposed_pool_max_depth_m: number | null;
  proposed_pool_lane_count: number | null;
  proposed_pool_certified: boolean;
  proposed_pool_certifier: string | null;
  proposed_has_lifeguard: boolean;
  proposed_has_eap: boolean;
  proposed_has_first_aid_aed: boolean;
  proposed_has_adequate_deck: boolean;
}
interface Attention { id: string; name: string; state: string; status: string; flagged_at: string; }

const STAT: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'New', cls: 'is-warning' },
  pending:   { label: 'In review', cls: 'is-info' },
  approved:  { label: 'Approved', cls: 'is-success' },
  denied:    { label: 'Denied', cls: 'is-danger' },
  archived:  { label: 'Archived', cls: '' },
};

function fmt(iso: string | null): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}
function pretty(s: string | null): string {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
function imageUrl(path: string | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from('centre-photos').getPublicUrl(path).data.publicUrl;
}

const CSS = `
.mas-review-proposed {
  background: #f8fafd; border: 1px solid var(--mas-line, #e3e9f3);
  border-radius: 8px; padding: 1rem 1.2rem; margin-top: 1rem;
}
.mas-review-proposed h3 {
  font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--mas-navy, #1E2752); margin: 0.5rem 0 0.4rem;
  border-bottom: 1px solid var(--mas-line, #e3e9f3); padding-bottom: 0.3rem;
}
.mas-review-proposed h3:first-of-type { margin-top: 0; }
.mas-review-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.4rem 1rem; font-size: 0.88rem; }
.mas-review-grid dt { color: var(--mas-muted, #5b6472); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
.mas-review-grid dd { margin: 0 0 0.4rem; color: var(--mas-navy, #1E2752); }
.mas-review-photos { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.4rem; }
.mas-review-photos img {
  width: 5rem; height: 5rem; object-fit: cover; border-radius: 6px;
  border: 1px solid var(--mas-line, #e3e9f3);
}
.mas-review-photos img.hero { outline: 2px solid var(--mas-gold, #F9C610); }
.mas-review-check { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; padding: 0.15rem 0; }
.mas-review-check .yes { color: #0d5928; font-weight: 600; }
.mas-review-check .no  { color: var(--mas-muted, #5b6472); }
.mas-req-badges { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.mas-req-badge {
  font-size: 0.7rem; padding: 0.15rem 0.55rem; border-radius: 999px;
  text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;
  border: 1px solid var(--mas-line, #e3e9f3); background: #fff; color: var(--mas-muted, #5b6472);
}
.mas-req-badge.is-requested { background: #eef1f8; color: var(--mas-navy, #1E2752); border-color: transparent; }
.mas-req-badge.is-granted   { background: #dff3e6; color: #0d5928; border-color: transparent; }
.mas-decision-block {
  display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center;
  margin-top: 0.6rem;
}
`;

export default function PartnerApplications() {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [attention, setAttention] = useState<Attention[]>([]);
  const [includeDecided, setIncludeDecided] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, n] = await Promise.all([
      supabase.rpc('list_partner_applications_full', { _include_decided: includeDecided }),
      supabase.rpc('list_centres_needing_attention'),
    ]);
    setApps((a.data ?? []) as AppRow[]);
    setAttention((n.data ?? []) as Attention[]);
    setLoading(false);
  }, [includeDecided]);

  useEffect(() => { load(); }, [load]);

  async function acknowledge(id: string) {
    setBusyId(id);
    const { error } = await supabase.rpc('acknowledge_partner_application', { _app_id: id });
    setBusyId(null);
    if (error) { alert(error.message); return; }
    load();
  }

  async function grant(id: string, grantTeach: boolean, grantAssess: boolean) {
    setBusyId(id);
    const { error } = await supabase.rpc('decide_partner_application_split', {
      _app_id: id,
      _grant_teach: grantTeach,
      _grant_assess: grantAssess,
      _note: notes[id] || null,
    });
    setBusyId(null);
    if (error) { alert(error.message); return; }
    load();
  }

  async function deny(id: string) {
    if (!window.confirm('Deny this application? Neither teaching nor assessment will be granted.')) return;
    setBusyId(id);
    const { error } = await supabase.rpc('decide_partner_application_split', {
      _app_id: id, _grant_teach: false, _grant_assess: false, _note: notes[id] || null,
    });
    setBusyId(null);
    if (error) { alert(error.message); return; }
    load();
  }

  const newCount = useMemo(() => apps.filter((a) => a.status === 'submitted').length, [apps]);

  return (
    <section className="mas-page">
      <style>{CSS}</style>
      <header className="mas-page-head mas-page-head-row">
        <div>
          <p className="mas-eyebrow">Partner centres</p>
          <h1>Centre applications</h1>
          <p className="mas-lede">
            Applications submitted through the public form or by appointed instructors.
            Acknowledge to start handling, then grant teaching and assessment
            recognition independently based on your review.
          </p>
        </div>
        <div className="mas-page-actions">
          <button className="mas-btn-ghost" onClick={() => setIncludeDecided((v) => !v)}>
            {includeDecided ? 'Hide decided' : 'Show decided'}
          </button>
        </div>
      </header>

      {attention.length > 0 && (
        <div className="mas-alert is-danger">
          <div className="mas-alert-body">
            <p className="mas-alert-title">{attention.length} centre{attention.length === 1 ? '' : 's'} without an active instructor</p>
            <p className="mas-alert-text">
              {attention.map((c) => `${c.name} (${pretty(c.state)})`).join(' · ')}.
              These need a centre-appointed instructor to stay legitimate — follow up before renewal.
            </p>
          </div>
        </div>
      )}

      {newCount > 0 && (
        <div className="mas-alert is-warning">
          <div className="mas-alert-body">
            <p className="mas-alert-title">{newCount} new application{newCount === 1 ? '' : 's'}</p>
            <p className="mas-alert-text">Acknowledge each once you&rsquo;ve picked it up.</p>
          </div>
        </div>
      )}

      {loading && <p className="mas-status">Loading…</p>}
      {!loading && apps.length === 0 && <p className="mas-status">No applications right now.</p>}

      {!loading && apps.map((a) => {
        const isOpen = expanded === a.id;
        const isOpenDecision = a.status === 'submitted' || a.status === 'pending';
        return (
          <Fragment key={a.id}>
            <div className="mas-form" style={{ marginBottom: '0.9rem' }}>
              <div className="mas-form-cardhead">
                <div>
                  <span className={`mas-badge ${STAT[a.status]?.cls ?? ''}`}>{STAT[a.status]?.label ?? a.status}</span>
                  <h2 style={{ marginTop: '0.5rem' }}>{a.centre_name}</h2>
                </div>
                <span className="mas-field-opt">{fmt(a.created_at)}</span>
              </div>

              <div className="mas-form-grid">
                <div className="mas-field">
                  <span className="mas-field-label">State</span><div>{pretty(a.state)}</div>
                  <span className="mas-field-label" style={{ marginTop: '0.5rem' }}>Appointed instructor</span>
                  <div>{a.submitted_by ?? '—'}</div>
                </div>
                <div className="mas-field">
                  <span className="mas-field-label">Point of communication</span>
                  <div>{a.poc_name ?? '—'}</div>
                  <a className="mas-link" href={`mailto:${a.poc_email}`}>{a.poc_email}</a>
                  {a.poc_phone && <div className="mas-field-note">{a.poc_phone}</div>}
                </div>
              </div>

              {/* Live status of what's requested vs granted */}
              <div className="mas-req-badges" style={{ marginTop: '0.7rem' }}>
                {a.requested_can_teach && (
                  <span className={`mas-req-badge ${a.can_teach_now ? 'is-granted' : 'is-requested'}`}>
                    {a.can_teach_now ? '✓ Teaching granted' : 'Teaching requested'}
                  </span>
                )}
                {a.requested_can_assess && (
                  <span className={`mas-req-badge ${a.can_assess_now ? 'is-granted' : 'is-requested'}`}>
                    {a.can_assess_now ? '✓ Assessment granted' : 'Assessment requested'}
                  </span>
                )}
                {!a.requested_can_teach && !a.requested_can_assess && (
                  <span className="mas-req-badge">Nothing requested yet — applicant may still be filling in details</span>
                )}
              </div>

              {a.decision_note && <p className="mas-field-note" style={{ marginTop: '0.5rem' }}>Note: {a.decision_note}</p>}

              {/* Expand / collapse proposed details */}
              <div style={{ marginTop: '0.6rem' }}>
                <button className="mas-link" onClick={() => setExpanded(isOpen ? null : a.id)}>
                  {isOpen ? 'Hide proposed details ▲' : 'Show proposed details ▼'}
                </button>
              </div>

              {isOpen && (
                <div className="mas-review-proposed">
                  {(a.proposed_public_blurb || a.proposed_address_line1) && (
                    <>
                      <h3>Public directory content</h3>
                      {a.proposed_public_blurb && (
                        <p style={{ fontSize: '0.9rem', margin: '0 0 0.5rem', color: 'var(--mas-navy,#1E2752)' }}>
                          {a.proposed_public_blurb}
                        </p>
                      )}
                      <dl className="mas-review-grid">
                        {(a.proposed_address_line1 || a.proposed_city) && (
                          <>
                            <dt>Address</dt>
                            <dd>
                              {a.proposed_address_line1}
                              {a.proposed_address_line2 && <><br />{a.proposed_address_line2}</>}
                              {a.proposed_city && <><br />{a.proposed_city}</>}
                              {a.proposed_postcode && ` ${a.proposed_postcode}`}
                            </dd>
                          </>
                        )}
                        {a.proposed_google_maps_url && (
                          <>
                            <dt>Google Maps</dt>
                            <dd><a href={a.proposed_google_maps_url} target="_blank" rel="noopener noreferrer">Open ↗</a></dd>
                          </>
                        )}
                        {a.proposed_public_phone && (
                          <>
                            <dt>Public phone</dt><dd>{a.proposed_public_phone}</dd>
                          </>
                        )}
                        {a.proposed_public_email && (
                          <>
                            <dt>Public email</dt><dd>{a.proposed_public_email}</dd>
                          </>
                        )}
                        {a.proposed_hours_text && (
                          <>
                            <dt>Operating hours</dt><dd>{a.proposed_hours_text}</dd>
                          </>
                        )}
                      </dl>
                    </>
                  )}

                  {a.proposed_image_paths && a.proposed_image_paths.length > 0 && (
                    <>
                      <h3>Submitted photos</h3>
                      <div className="mas-review-photos">
                        {a.proposed_image_paths.map((p, i) => (
                          <img key={p} src={imageUrl(p) ?? ''} alt=""
                            className={i === 0 ? 'hero' : ''} title={i === 0 ? 'Hero' : ''} />
                        ))}
                      </div>
                    </>
                  )}

                  {a.requested_can_assess && (
                    <>
                      <h3>Fit-for-assessment: pool &amp; safety</h3>
                      <dl className="mas-review-grid">
                        {a.proposed_pool_length_m != null && (<><dt>Pool length</dt><dd>{a.proposed_pool_length_m} m</dd></>)}
                        {a.proposed_pool_min_depth_m != null && (<><dt>Min depth</dt><dd>{a.proposed_pool_min_depth_m} m</dd></>)}
                        {a.proposed_pool_max_depth_m != null && (<><dt>Max depth</dt><dd>{a.proposed_pool_max_depth_m} m</dd></>)}
                        {a.proposed_pool_lane_count != null && (<><dt>Lanes</dt><dd>{a.proposed_pool_lane_count}</dd></>)}
                        {a.proposed_pool_certifier && (<><dt>Certifier</dt><dd>{a.proposed_pool_certifier}</dd></>)}
                      </dl>
                      <div style={{ marginTop: '0.5rem' }}>
                        <div className="mas-review-check">
                          <span className={a.proposed_pool_certified ? 'yes' : 'no'}>{a.proposed_pool_certified ? '✓' : '○'}</span>
                          Pool certified
                        </div>
                        <div className="mas-review-check">
                          <span className={a.proposed_has_lifeguard ? 'yes' : 'no'}>{a.proposed_has_lifeguard ? '✓' : '○'}</span>
                          Lifeguard on duty
                        </div>
                        <div className="mas-review-check">
                          <span className={a.proposed_has_eap ? 'yes' : 'no'}>{a.proposed_has_eap ? '✓' : '○'}</span>
                          Emergency Action Plan documented
                        </div>
                        <div className="mas-review-check">
                          <span className={a.proposed_has_first_aid_aed ? 'yes' : 'no'}>{a.proposed_has_first_aid_aed ? '✓' : '○'}</span>
                          First aid + AED on site
                        </div>
                        <div className="mas-review-check">
                          <span className={a.proposed_has_adequate_deck ? 'yes' : 'no'}>{a.proposed_has_adequate_deck ? '✓' : '○'}</span>
                          Adequate deck space
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {isOpenDecision && (
                <div style={{ marginTop: '1rem' }}>
                  <input className="mas-input" placeholder="Optional decision note…" value={notes[a.id] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))} style={{ marginBottom: '0.6rem' }} />
                  <div className="mas-decision-block">
                    {a.status === 'submitted' && (
                      <button className="mas-btn-ghost" disabled={busyId === a.id} onClick={() => acknowledge(a.id)}>
                        Acknowledge
                      </button>
                    )}
                    {a.requested_can_teach && !a.can_teach_now && (
                      <button className="mas-btn-success" disabled={busyId === a.id}
                        onClick={() => grant(a.id, true, a.can_assess_now)}>
                        {busyId === a.id ? 'Saving…' : 'Grant teaching'}
                      </button>
                    )}
                    {a.requested_can_assess && !a.can_assess_now && (
                      <button className="mas-btn-success" disabled={busyId === a.id}
                        onClick={() => grant(a.id, a.can_teach_now, true)}>
                        {busyId === a.id ? 'Saving…' : 'Grant assessment'}
                      </button>
                    )}
                    <button className="mas-btn-danger" disabled={busyId === a.id} onClick={() => deny(a.id)}>
                      Deny application
                    </button>
                  </div>
                  <p className="mas-field-note" style={{ marginTop: '0.5rem' }}>
                    Granting either capability seeds the public directory fields from the applicant&rsquo;s
                    submission; you can refine them afterwards in Governance → Partner centres → Public directory.
                  </p>
                </div>
              )}
            </div>
          </Fragment>
        );
      })}
    </section>
  );
}
