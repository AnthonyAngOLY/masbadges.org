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

// READ-ONLY capability map — reflects what the RLS policies + has_role() actually
// grant. Maintained in code alongside the migrations; editing the catalog (left)
// never changes these. This is the honest "what this role can really do".
const CAPABILITIES: Record<string, string[]> = {
  chairperson: ['Approve / deny centre applications', 'Manage centres & memberships', 'Assessment oversight', 'Set centre billing (Step 9)', 'All governance reads'],
  board_member: ['Manage centres & memberships', 'Approve / deny centre applications', 'Assessment oversight'],
  chief_examiner: ['Examiner registry & invitations (UIDs)', 'Assessment oversight', 'Grade assessments', 'Certificate registry'],
  examiner_trainer: ['Manage & schedule courses'],
  instructor_trainer: ['Invite / onboard instructors', 'Manage & schedule courses'],
  coaching_panel: ['Advisory; governance reads'],
  examiner: ['Receive assessment invitations', 'Conduct & grade assessments', 'Issue certificates (self-stamped)', 'Blocked from assessing own-registered candidates'],
  instructor: ['Register candidates', 'Schedule assessments', 'Register / represent an appointed centre', 'Print claim slips', 'View own invoices'],
  partner_center_admin: ['Administer own centre (contact details)', 'View centre invoices', 'Scoped to a single centre'],
  finance_officer: ['Record payments in against invoices', 'Prepare payment vouchers (money out)', 'Pay approved vouchers', 'Cannot approve a voucher they prepared'],
  finance_approver: ['Approve payment vouchers prepared by someone else', 'Approval allocates the voucher number', 'No payment or preparation rights of its own'],
  system_admin: ['Full administrative access (role wildcard)', 'Accounts & invoicing', 'Instructor & course administration', 'All queues', 'Should remain non-operational'],
};

export default function RoleRegistry() {
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<CatalogRow>>>({});
  const [savedRole, setSavedRole] = useState<string | null>(null);
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
    await supabase.rpc('upsert_role_catalog', {
      _role: role,
      _summary: field(role, 'summary'),
      _responsibilities: field(role, 'responsibilities'),
      _who_invites: field(role, 'who_invites'),
      _notes: field(role, 'notes'),
    });
    setBusyRole(null);
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
