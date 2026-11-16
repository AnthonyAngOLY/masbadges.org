import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/admin.css';

interface CatalogRow {
  role: string;
  display_name: string;
  summary: string | null;
  responsibilities: string | null;
  who_invites: string | null;
  notes: string | null;
  sort_order: number;
}
interface Warning { profile_id: string; person: string; code: string; message: string; }

// READ-ONLY capability map — the honest "what this role can really do".
//
// MAINTENANCE: this map is per-role and must agree with the route table in
// App.tsx and the gate functions in the database. It had drifted badly and was
// corrected in full; when you change a RequireRole list, change the matching
// entry here in the same commit.
//
// Corrections made, each verified against the route table:
//   · instructor_trainer claimed it could "Invite / onboard instructors".
//     It cannot — /admin/instructors is master_trainer / chairperson /
//     board_member. The claim belonged to master_trainer.
//   · master_trainer had NO entry at all, despite being the role that
//     actually onboards instructors.
//   · examiner claimed "Receive assessment invitations" and "Issue
//     certificates (self-stamped)". Both are obsolete: examiners now self-pick
//     from an open pool (Invitations.tsx), and certificate issuance is
//     automatic on examiner submit (CertificateIssuance.tsx).
//   · board_member claimed memberships. /admin/memberships is chairperson and
//     system_admin only.
//
// ORG NOTE: MAS appoints ONE person to master_trainer + instructor_trainer +
// examiner_trainer. The three entries below are kept separate because the map
// documents roles, not people, and each grants a different set.
const CAPABILITIES: Record<string, string[]> = {
  chairperson: [
    'Approve / deny centre applications',
    'Manage centres; grant & revoke memberships',
    'Set centre billing',
    'Approve payment vouchers — but never one they prepared',
    'Assessment oversight & grading',
    'Audit log; all governance reads',
  ],
  board_member: [
    'Approve / deny centre applications',
    'Manage centres; instructor blacklist',
    'Assessment oversight & grading',
    'NOT memberships, payments or the audit log — those are chairperson-only',
  ],
  chief_examiner: [
    'Examiner registry: onboards examiners, issues UIDs, revokes',
    'Carries examiner welfare',
    'Grade assessments; certificate registry',
    'Session lifecycle oversight',
  ],
  master_trainer: [
    'Onboards & administers instructors (invite, list, revoke)',
    'Carries instructor welfare',
    'Trains BOTH instructors and examiners — delivers both certification courses',
    'Session tracker across the programme; own payouts',
    'Course scheduling comes from instructor_trainer / examiner_trainer, not this role',
  ],
  instructor_trainer: [
    'Manage & schedule courses',
    'Handle enquiries',
    'Does NOT onboard instructors — that is master_trainer',
  ],
  examiner_trainer: [
    'Manage & schedule courses',
  ],
  coaching_panel: [
    'Ratifies examiner appointments — a governance act, performed off-platform',
    'Grants NO portal screens at all',
  ],
  examiner: [
    'Picks up open sessions from the pool — not invited to a named session',
    'Conduct & grade assessments; declare a weather hold',
    'Certificate registry (read) — issuance is automatic on submit, not self-stamped',
    'Blocked in data from assessing candidates they instruct',
    'Sees no fee or payment value anywhere on the grading screen',
  ],
  instructor: [
    'Register candidates; print claim slips',
    'Book assessment sessions — the roster locks at creation',
    'Register / represent an appointed centre',
    'View own invoices; opt in to the public instructor directory',
  ],
  partner_center_admin: [
    'Administer own centre (contact details, public listing)',
    'View centre invoices',
    'Scoped to a single centre',
  ],
  finance_officer: [
    'The MAS officer — a conduit for money, not the authority over it',
    'Record payments in; this is what releases a session to the examiner pool',
    'Centre recognition billing',
    'Prepare payment vouchers; pay them once approved',
    'Work the store order queue (invoice → paid → shipped)',
    'Cannot approve a voucher they prepared — enforced in the database',
    'Cannot set store prices — the catalogue belongs to governance',
  ],
  finance_approver: [
    'NOT APPOINTED — MAS runs a single Finance Officer',
    'Authorisation and financial safeguards fall back to MAS-side policy, off-platform',
    'If ever granted: approves vouchers prepared by someone else, and approval allocates the voucher number',
  ],
  system_admin: [
    'Full administrative access (role wildcard)',
    'Account provisioning, system settings, website content',
    'Role registry & audit log',
    'The wildcard does NOT exempt it from voucher separation of duties',
    'Should remain non-operational',
  ],
};

export default function RoleRegistry() {
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<CatalogRow>>>({});
  const [savedRole, setSavedRole] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<Record<string, string>>({});
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, w] = await Promise.all([
      supabase.rpc('get_role_catalog'),
      supabase.rpc('lint_memberships'),
    ]);
    setRows((c.data ?? []) as CatalogRow[]);
    setWarnings((w.data ?? []) as Warning[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function field(role: string, key: keyof CatalogRow): string {
    const e = edits[role];
    if (e && key in e) return (e[key] as string) ?? '';
    const row = rows.find((r) => r.role === role);
    return ((row?.[key] as string) ?? '') || '';
  }
  function setField(role: string, key: keyof CatalogRow, val: string) {
    setEdits((p) => ({ ...p, [role]: { ...p[role], [key]: val } }));
    setSavedRole(null);
  }

  async function save(role: string) {
    setBusyRole(role);
    setSaveError((p) => { const n = { ...p }; delete n[role]; return n; });
    const { error } = await supabase.rpc('upsert_role_catalog', {
      _role: role,
      _summary: field(role, 'summary'),
      _responsibilities: field(role, 'responsibilities'),
      _who_invites: field(role, 'who_invites'),
      _notes: field(role, 'notes'),
    });
    setBusyRole(null);
    if (error) {
      // Keep the pending edits on screen — clearing them on a failed save threw
      // away the user's typing and then showed "Saved".
      setSaveError((p) => ({ ...p, [role]: error.message }));
      return;
    }
    setSavedRole(role);
    setEdits((p) => { const n = { ...p }; delete n[role]; return n; });
    load();
  }

  return (
    <section className="mas-page">
      <header className="mas-page-head">
        <p className="mas-eyebrow">Web settings</p>
        <h1>Roles &amp; policies</h1>
        <p className="mas-lede">
          Edit each role’s description, responsibilities, and who invites it. The
          capability list beside each is read-only — it reflects what the security
          policies actually grant, and changing real access still requires a
          migration. Below are advisory warnings on current assignments.
        </p>
      </header>

      <header className="mas-page-head mas-section-head"><h2>Policy warnings</h2></header>
      {loading && <p className="mas-status">Loading…</p>}
      {!loading && warnings.length === 0 && (
        <div className="mas-alert is-success">
          <div className="mas-alert-body"><p className="mas-alert-text">No assignment conflicts detected.</p></div>
        </div>
      )}
      {warnings.map((w, i) => (
        <div key={`${w.profile_id}-${w.code}-${i}`} className="mas-alert is-warning">
          <div className="mas-alert-body">
            <p className="mas-alert-title">{w.person}</p>
            <p className="mas-alert-text">{w.message}</p>
          </div>
        </div>
      ))}

      <header className="mas-page-head mas-section-head"><h2>Role catalog</h2></header>
      {rows.map((r) => (
        <div key={r.role} className="mas-form" style={{ marginBottom: '0.9rem' }}>
          <div className="mas-form-cardhead">
            <div>
              <p className="mas-eyebrow">{r.role}</p>
              <h2>{r.display_name}</h2>
            </div>
            {savedRole === r.role && <span className="mas-badge is-success">Saved</span>}
          </div>
          {saveError[r.role] && <p className="mas-status mas-status-bad">{saveError[r.role]}</p>}

          <div className="mas-form-grid">
            <div className="mas-field">
              <label className="mas-field-label">Summary</label>
              <input className="mas-input" value={field(r.role, 'summary')} onChange={(e) => setField(r.role, 'summary', e.target.value)} />
              <label className="mas-field-label" style={{ marginTop: '0.75rem' }}>Responsibilities</label>
              <textarea className="mas-input" rows={3} style={{ resize: 'vertical' }}
                value={field(r.role, 'responsibilities')} onChange={(e) => setField(r.role, 'responsibilities', e.target.value)} />
              <label className="mas-field-label" style={{ marginTop: '0.75rem' }}>Who invites this role</label>
              <input className="mas-input" value={field(r.role, 'who_invites')} onChange={(e) => setField(r.role, 'who_invites', e.target.value)} />
              <label className="mas-field-label" style={{ marginTop: '0.75rem' }}>Notes</label>
              <textarea className="mas-input" rows={2} style={{ resize: 'vertical' }}
                value={field(r.role, 'notes')} onChange={(e) => setField(r.role, 'notes', e.target.value)} />
              <div className="mas-form-actions" style={{ marginTop: '0.85rem' }}>
                <button className="mas-btn-primary" disabled={busyRole === r.role} onClick={() => save(r.role)}>
                  {busyRole === r.role ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            <div className="mas-field">
              <label className="mas-field-label">What this role can actually do</label>
              <span className="mas-badge" style={{ marginBottom: '0.5rem', alignSelf: 'flex-start' }}>Read-only · policy-derived</span>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', lineHeight: 1.7 }}>
                {(CAPABILITIES[r.role] ?? ['—']).map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
