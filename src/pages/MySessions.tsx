// Universal session tracker (#15). Role-scoped via list_session_tracker():
// governance (chair/sysadmin/finance_officer/chief_examiner/board_member) see ALL
// sessions; everyone else sees sessions they booked OR are assigned to assess.
// Each row: six-step checkpoint bar; expand for both-way contacts (booker + examiner),
// remarks (instructor's + examiner's, when present), and the cancel action.
//   list   ← list_session_tracker() → session_id, venue, state, scheduled_on, status,
//            receipt_no, invoice_status, cp_* (6), candidate_count, booker_* (3),
//            examiner_* (3), is_mine_booked, is_mine_assigned, instructor_remarks,
//            examiner_remarks, rescheduled_from, reschedule_count, weather_reason
//   cancel ← cancel_session(_session_id) → { session_id, status, within_72h, refund_due }
// WEATHER: a rained-off session (status weather_hold) shows a "Reschedule (weather)"
// card in the expanded row. reschedule_weather_session() moves it IN PLACE — same
// paid invoice, no new charge — exempt from the 30-day floor, keeping or releasing
// the examiner.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import CheckpointBar from '../components/CheckpointBar';
import SessionProcessOverview, { ProcessOverview } from '../components/SessionProcessOverview';
import '../styles/admin.css';

interface FinancialFlag {
  reconciled: boolean;
  has_bonus: boolean;
  payouts_pending: number;
}

interface TrackerRow {
  session_id: string;
  venue: string | null;
  state: string | null;
  scheduled_on: string | null;
  status: string;
  receipt_no: string | null;
  invoice_status: string | null;
  cp_created: boolean;
  cp_roster: boolean;
  cp_paid: boolean;
  cp_examiner: boolean;
  cp_completed: boolean;
  cp_certs: boolean;
  candidate_count: number;
  booker_name: string | null;
  booker_phone: string | null;
  booker_email: string | null;
  examiner_name: string | null;
  examiner_phone: string | null;
  examiner_email: string | null;
  is_mine_booked: boolean;
  is_mine_assigned: boolean;
  instructor_remarks: string | null;
  examiner_remarks: string | null;
  rescheduled_from: string | null;
  reschedule_count: number;
  weather_reason: string | null;
}
interface CancelResult {
  session_id: string;
  status: string;
  within_72h: boolean;
  refund_due: boolean;
}
interface SessionCert {
  serial: string;
  candidate_name: string;
  level: string;
  billing_stage: string;
  issued_on: string | null;
}
interface AuditEvent {
  id: string;
  actor_name: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}
type Load = 'loading' | 'ready' | 'error';
type Tab = 'unreconciled' | 'active' | 'awaiting_pickup' | 'completed' | 'closed' | 'cancelled' | 'archived' | 'all';

const TERMINAL = new Set(['completed', 'closed', 'cancelled', 'archived']);

// Which statuses fall under each tab.
// Status-based tab predicates. 'unreconciled' is NOT here — it depends on the
// finance flags, not status, so it's handled specially in matchesTab().
const TAB_MATCH: Record<Tab, (s: string) => boolean> = {
  unreconciled: () => false,
  active: (s) => ['awaiting_payment', 'open_for_pickup', 'claimed', 'scheduled', 'requested', 'examiner_invited', 'weather_hold'].includes(s),
  awaiting_pickup: (s) => s === 'open_for_pickup',
  completed: (s) => s === 'completed',
  closed: (s) => s === 'closed',
  cancelled: (s) => s === 'cancelled',
  archived: (s) => s === 'archived',
  all: () => true,
};
const TAB_LABEL: Record<Tab, string> = {
  unreconciled: 'Unreconciled',
  active: 'Active',
  awaiting_pickup: 'Awaiting pickup',
  completed: 'Completed',
  closed: 'Closed',
  cancelled: 'Cancelled',
  archived: 'Archived',
  all: 'All',
};
// Base (status) tabs shown to everyone. The finance tier additionally gets
// 'unreconciled' prepended (see visibleTabs in the component).
const TAB_ORDER: Tab[] = ['active', 'awaiting_pickup', 'completed', 'closed', 'cancelled', 'archived', 'all'];

function prettyDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function pretty(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
function statusLabel(s: string): string {
  if (s === 'pro_forma') return 'Estimate';
  if (s === 'issued') return 'Awaiting payment';
  if (s === 'paid') return 'Paid';
  if (s === 'void') return 'Void';
  if (s === 'weather_hold') return 'Weather hold';
  return pretty(s);
}

const AUDIT_LABEL: Record<string, string> = {
  payment_recorded: 'Payment recorded',
  refund_recorded: 'Refund recorded',
  payout_recorded: 'Payout recorded',
  session_reopened: 'Session reopened',
  weather_hold: 'Rain-off declared',
  weather_reschedule: 'Rescheduled (weather)',
};
function auditSummary(e: AuditEvent): string {
  const d = e.detail ?? {};
  if (e.action === 'session_reopened') return `Reason: ${String(d.reason ?? '—')}`;
  if (e.action === 'weather_hold') return d.reason ? `Reason: ${String(d.reason)}` : '';
  if (e.action === 'weather_reschedule') {
    const from = d.from_date ? prettyDate(String(d.from_date)) : '—';
    const to = d.to_date ? prettyDate(String(d.to_date)) : '—';
    return `${from} → ${to}${d.kept_examiner === false ? ' · released to pool' : ''}`;
  }
  const parts: string[] = [];
  if (d.amount != null) parts.push(`RM ${Number(d.amount).toFixed(2)}`);
  if (d.method) parts.push(String(d.method));
  if (d.reference) parts.push(`ref ${String(d.reference)}`);
  if (d.note) parts.push(String(d.note));
  return parts.join(' · ');
}
function auditWhen(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function MySessions() {
  const [rows, setRows] = useState<TrackerRow[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('active');

  const [confirmRow, setConfirmRow] = useState<TrackerRow | null>(null);
  const [cancelBusy, setCancelBusy] = useState<string | null>(null);
  const [cancelResult, setCancelResult] = useState<Record<string, CancelResult>>({});
  const [cancelError, setCancelError] = useState<Record<string, string>>({});

  // Weather reschedule state (per session).
  const [rsDate, setRsDate] = useState<Record<string, string>>({});
  const [rsVenue, setRsVenue] = useState<Record<string, string>>({});
  const [rsKeep, setRsKeep] = useState<Record<string, boolean>>({});
  const [rsBusy, setRsBusy] = useState<string | null>(null);
  const [rsError, setRsError] = useState<Record<string, string>>({});
  const todayIso = new Date().toISOString().slice(0, 10);

  // Per-session certificates, fetched lazily on expand.
  const [certs, setCerts] = useState<Record<string, SessionCert[]>>({});
  const [certLoad, setCertLoad] = useState<Record<string, 'loading' | 'ready' | 'error'>>({});

  // Per-session audit trail (governance only — returns empty for others).
  const [audit, setAudit] = useState<Record<string, AuditEvent[]>>({});

  // Finance-governance overlay. list_session_financial_flags() returns rows only
  // for the finance tier (FO / finance_approver / chairperson / sysadmin /
  // chief_examiner); empty for everyone else — so a non-empty map == finance view.
  const [flags, setFlags] = useState<Record<string, FinancialFlag>>({});
  const [overview, setOverview] = useState<Record<string, ProcessOverview | null>>({});
  const [overviewLoad, setOverviewLoad] = useState<Record<string, 'loading' | 'ready' | 'error'>>({});
  const financialGov = useMemo(() => Object.keys(flags).length > 0, [flags]);

  const fetchFlags = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_session_financial_flags');
    if (error) return; // not finance tier → leave empty
    const map: Record<string, FinancialFlag> = {};
    for (const r of (data ?? []) as (FinancialFlag & { session_id: string })[]) {
      map[r.session_id] = { reconciled: r.reconciled, has_bonus: r.has_bonus, payouts_pending: r.payouts_pending };
    }
    setFlags(map);
  }, []);

  const fetchOverview = useCallback(async (sessionId: string) => {
    setOverviewLoad((m) => ({ ...m, [sessionId]: 'loading' }));
    const { data, error } = await supabase.rpc('get_session_process_overview', { _session_id: sessionId });
    if (error) {
      setOverviewLoad((m) => ({ ...m, [sessionId]: 'error' }));
      return;
    }
    setOverview((m) => ({ ...m, [sessionId]: (data ?? null) as ProcessOverview | null }));
    setOverviewLoad((m) => ({ ...m, [sessionId]: 'ready' }));
  }, []);

  const fetchCerts = useCallback(async (sessionId: string) => {
    setCertLoad((m) => ({ ...m, [sessionId]: 'loading' }));
    const { data, error } = await supabase.rpc('list_session_certificates', { _session_id: sessionId });
    if (error) {
      setCertLoad((m) => ({ ...m, [sessionId]: 'error' }));
      return;
    }
    setCerts((m) => ({ ...m, [sessionId]: (data ?? []) as SessionCert[] }));
    setCertLoad((m) => ({ ...m, [sessionId]: 'ready' }));
  }, []);

  const fetchAudit = useCallback(async (sessionId: string) => {
    const { data, error } = await supabase.rpc('list_audit_log', { _session_id: sessionId, _limit: 50 });
    if (error) return; // not authorized / no access → leave empty
    setAudit((m) => ({ ...m, [sessionId]: (data ?? []) as AuditEvent[] }));
  }, []);

  function toggleExpand(sessionId: string) {
    setExpanded((cur) => {
      const next = cur === sessionId ? null : sessionId;
      if (next && certs[sessionId] === undefined) fetchCerts(sessionId);
      if (next && audit[sessionId] === undefined) fetchAudit(sessionId);
      if (next && financialGov && overview[sessionId] === undefined) fetchOverview(sessionId);
      return next;
    });
  }

  // Accordion: click outside any row (or the confirm modal) collapses the
  // currently-open row.
  useEffect(() => {
    if (!expanded) return;
    function onDocDown(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('tr')) return;              // click inside a row → row-level handlers decide
      if (t.closest('.mas-modal-backdrop')) return;  // click on cancel modal
      setExpanded(null);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [expanded]);

  const fetchSessions = useCallback(async () => {
    setLoad('loading');
    const { data, error } = await supabase.rpc('list_session_tracker');
    if (error) {
      setLoad('error');
      return;
    }
    setRows((data ?? []) as TrackerRow[]);
    setLoad('ready');
  }, []);

  useEffect(() => {
    fetchSessions();
    fetchFlags();
  }, [fetchSessions, fetchFlags]);

  // Governance sees rows that are neither booked-by-me nor assigned-to-me → "all sessions".
  const isGovernanceView = useMemo(
    () => rows.some((r) => !r.is_mine_booked && !r.is_mine_assigned),
    [rows],
  );

  // Finance tier additionally sees an "Unreconciled" triage tab up front.
  const visibleTabs = useMemo<Tab[]>(
    () => (financialGov ? (['unreconciled', ...TAB_ORDER] as Tab[]) : TAB_ORDER),
    [financialGov],
  );

  // 'unreconciled' filters on the finance flag (any status except cancelled —
  // a cancelled session's outstanding money moves via its refund voucher, which
  // the FO tracks in the voucher register, not here).
  const matchesTab = useCallback(
    (row: TrackerRow, t: Tab): boolean => {
      if (t === 'unreconciled') {
        const f = flags[row.session_id];
        return !!f && !f.reconciled && row.status !== 'cancelled';
      }
      return TAB_MATCH[t](row.status);
    },
    [flags],
  );

  const counts = useMemo(() => {
    const c = {} as Record<Tab, number>;
    for (const t of visibleTabs) c[t] = rows.filter((r) => matchesTab(r, t)).length;
    return c;
  }, [rows, visibleTabs, matchesTab]);

  const filtered = useMemo(() => rows.filter((r) => matchesTab(r, tab)), [rows, tab, matchesTab]);

  // If the selected tab isn't available (e.g. flags loaded/cleared), fall back.
  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab('active');
  }, [visibleTabs, tab]);

  async function cancelSession(row: TrackerRow) {
    setConfirmRow(null);
    setCancelError((m) => {
      const n = { ...m };
      delete n[row.session_id];
      return n;
    });
    setCancelBusy(row.session_id);
    const { data, error } = await supabase.rpc('cancel_session', { _session_id: row.session_id });
    setCancelBusy(null);
    if (error) {
      setCancelError((m) => ({ ...m, [row.session_id]: error.message }));
      return;
    }
    const result = (Array.isArray(data) ? data[0] : data) as CancelResult | null;
    if (result) setCancelResult((m) => ({ ...m, [row.session_id]: result }));
    await fetchSessions();
  }

  async function rescheduleSession(row: TrackerRow) {
    const date = rsDate[row.session_id];
    if (!date) {
      setRsError((m) => ({ ...m, [row.session_id]: 'Choose a new date.' }));
      return;
    }
    setRsBusy(row.session_id);
    setRsError((m) => {
      const n = { ...m };
      delete n[row.session_id];
      return n;
    });
    const { error } = await supabase.rpc('reschedule_weather_session', {
      _session_id: row.session_id,
      _new_date: date,
      _keep_examiner: row.cp_examiner ? (rsKeep[row.session_id] ?? true) : false,
      _new_venue: rsVenue[row.session_id]?.trim() || null,
    });
    setRsBusy(null);
    if (error) {
      setRsError((m) => ({ ...m, [row.session_id]: error.message }));
      return;
    }
    await fetchSessions();
  }

  return (
    <section className="mas-page">
      <header className="mas-page-head">
        <p className="mas-eyebrow">Assessments</p>
        <h1>{isGovernanceView ? 'All sessions' : 'My sessions'}</h1>
        <p className="mas-lede">
          {isGovernanceView
            ? 'Every assessment session, with each one’s progress from creation through to certificates issued. Expand a row for the booker and examiner contacts.'
            : 'The assessment sessions you’re involved in, with each one’s progress from creation through to certificates issued. Expand a row for contacts and to cancel a session you booked.'}
        </p>
      </header>

      <div className="mas-admin-toolbar" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
        <button className="mas-btn-ghost" onClick={fetchSessions} disabled={load === 'loading'}>
          Refresh
        </button>
        <div className="mas-tabs" role="tablist" style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {visibleTabs.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={
                (tab === t ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact')
                + (t === 'unreconciled' ? ' mas-tab-unrecon' : '')
              }
              onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]} ({counts[t]})
            </button>
          ))}
        </div>
      </div>

      {load === 'loading' && <p className="mas-status">Loading sessions…</p>}
      {load === 'error' && (
        <p className="mas-status mas-status-bad">Couldn’t load sessions. Refresh to try again.</p>
      )}
      {load === 'ready' && filtered.length === 0 && (
        <p className="mas-status">No sessions in this view.</p>
      )}

      {load === 'ready' && filtered.length > 0 && (
        <div className="mas-table-wrap">
          <style>{`
            .mas-sessions-tracker tbody tr[data-clickable="1"] { cursor: pointer; }
            .mas-sessions-tracker tbody tr[data-clickable="1"]:hover { background: #f5f8fc; }
            .mas-sessions-tracker tbody tr.is-open { background: #eef3fb; }
            .mas-weather-sub { color: #b4690e; font-weight: 600; }
            .mas-recon-pill { background: #dff3e6; color: #0d5928; font-size: 0.72rem; font-weight: 700; padding: 0.12rem 0.5rem; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; }
            .mas-btn-ghost.mas-tab-unrecon { color: #7a5b00; box-shadow: inset 0 0 0 1px #f0dcae; }
            .mas-btn-ghost.mas-tab-unrecon:hover { background: #fdf4e3; }
            .mas-reschedule-fields { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; align-items: flex-end; }
            .mas-reschedule-fields label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.8rem; }
            .mas-reschedule-fields input { font: inherit; padding: 0.35rem 0.45rem; border: 1px solid #e3e7ee; border-radius: 6px; }
            .mas-reschedule-fields input[type="text"] { min-width: 12rem; }
          `}</style>
          <table className="mas-table mas-sessions-tracker">
            <thead>
              <tr>
                <th>Venue</th>
                <th>Scheduled</th>
                <th>Status</th>
                <th className="mas-num">Cand.</th>
                <th>Receipt</th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const isOpen = expanded === row.session_id;
                const result = cancelResult[row.session_id];
                const effectiveStatus = result?.status ?? row.status;
                const canCancel =
                  row.is_mine_booked && !TERMINAL.has(effectiveStatus) && !result;
                const canReschedule =
                  row.status === 'weather_hold' && (row.is_mine_booked || isGovernanceView);
                const steps = [
                  { key: 'created', label: 'Created', done: row.cp_created },
                  { key: 'roster', label: 'Roster confirmed', done: row.cp_roster },
                  { key: 'paid', label: 'Payment cleared', done: row.cp_paid },
                  { key: 'examiner', label: 'Examiner assigned', done: row.cp_examiner },
                  { key: 'completed', label: 'Completed', done: row.cp_completed },
                  { key: 'certs', label: 'Certificates issued', done: row.cp_certs },
                ];
                return (
                  <Fragment key={row.session_id}>
                    <tr
                      className={isOpen ? 'is-open' : undefined}
                      data-clickable="1"
                      onClick={() => toggleExpand(row.session_id)}
                      aria-expanded={isOpen}
                    >
                      <td>
                        <span className="mas-cell-stack">
                          <span className="mas-cell-strong">{row.venue || 'Assessment session'}</span>
                          <span className="mas-cell-sub">
                            {row.state || ''}
                            {row.is_mine_booked ? ' · you booked' : row.is_mine_assigned ? ' · you assess' : ''}
                          </span>
                        </span>
                      </td>
                      <td>{prettyDate(row.scheduled_on)}</td>
                      <td>
                        <span className="mas-pill">{statusLabel(effectiveStatus)}</span>
                        {row.reschedule_count > 0 && (
                          <span className="mas-cell-sub mas-weather-sub" style={{ display: 'block' }}>
                            ↻ Rescheduled{row.reschedule_count > 1 ? ` ×${row.reschedule_count}` : ''} (weather)
                          </span>
                        )}
                        {financialGov && flags[row.session_id]?.reconciled && (
                          <span className="mas-recon-pill" style={{ display: 'inline-block', marginTop: '0.3rem' }}>
                            ✓ Reconciled
                          </span>
                        )}
                        {financialGov && (flags[row.session_id]?.payouts_pending ?? 0) > 0 && (
                          <span className="mas-cell-sub" style={{ display: 'block', color: '#7a5b00' }}>
                            {flags[row.session_id].payouts_pending} voucher{flags[row.session_id].payouts_pending > 1 ? 's' : ''} pending
                          </span>
                        )}
                      </td>
                      <td className="mas-num">{row.candidate_count}</td>
                      <td className="mas-cell-strong">{row.receipt_no ?? '—'}</td>
                      <td><CheckpointBar steps={steps} /></td>
                    </tr>

                    {isOpen && (
                      <tr className="mas-table-detailrow" onClick={(e) => e.stopPropagation()}>
                        <td colSpan={6}>
                          <div className="mas-table-detail mas-session-detail">
                            {financialGov && (
                              <div style={{ gridColumn: '1 / -1' }}>
                                <h3 className="mas-detail-heading">Process overview</h3>
                                {overviewLoad[row.session_id] === 'loading' && (
                                  <p className="mas-status">Loading process overview…</p>
                                )}
                                {overviewLoad[row.session_id] === 'error' && (
                                  <p className="mas-status mas-status-bad">Couldn’t load the process overview.</p>
                                )}
                                {overviewLoad[row.session_id] === 'ready' && overview[row.session_id] && (
                                  <SessionProcessOverview data={overview[row.session_id]!} />
                                )}
                              </div>
                            )}
                            <div>
                              <h3 className="mas-detail-heading">Booked by</h3>
                              {row.booker_name ? (
                                <ul className="mas-detail-list">
                                  <li><strong>{row.booker_name}</strong></li>
                                  {row.booker_phone && <li><a href={`tel:${row.booker_phone}`}>{row.booker_phone}</a></li>}
                                  {row.booker_email && <li><a href={`mailto:${row.booker_email}`}>{row.booker_email}</a></li>}
                                </ul>
                              ) : (
                                <p className="mas-status">—</p>
                              )}
                              {row.instructor_remarks && (
                                <>
                                  <h3 className="mas-detail-heading" style={{ marginTop: '0.75rem' }}>
                                    Instructor’s notes
                                  </h3>
                                  <p className="mas-status" style={{ whiteSpace: 'pre-wrap' }}>
                                    {row.instructor_remarks}
                                  </p>
                                </>
                              )}
                            </div>

                            <div>
                              <h3 className="mas-detail-heading">Examiner</h3>
                              {row.cp_examiner ? (
                                <ul className="mas-detail-list">
                                  <li><strong>{row.examiner_name || 'Assigned examiner'}</strong></li>
                                  {row.examiner_phone && <li><a href={`tel:${row.examiner_phone}`}>{row.examiner_phone}</a></li>}
                                  {row.examiner_email && <li><a href={`mailto:${row.examiner_email}`}>{row.examiner_email}</a></li>}
                                </ul>
                              ) : (
                                <p className="mas-status">Awaiting examiner pickup.</p>
                              )}
                              {row.examiner_remarks && (
                                <>
                                  <h3 className="mas-detail-heading" style={{ marginTop: '0.75rem' }}>
                                    Examiner’s notes
                                  </h3>
                                  <p className="mas-status" style={{ whiteSpace: 'pre-wrap' }}>
                                    {row.examiner_remarks}
                                  </p>
                                </>
                              )}
                            </div>

                            {canReschedule && (
                              <div>
                                <h3 className="mas-detail-heading">Reschedule (weather)</h3>
                                <p className="mas-status">
                                  This session was rained off. Set a new date to move it in place —{' '}
                                  <strong>no additional fee</strong>; the original payment carries over.
                                </p>
                                {row.weather_reason && (
                                  <p className="mas-status" style={{ marginTop: '0.25rem' }}>
                                    Rain-off note: {row.weather_reason}
                                  </p>
                                )}
                                <div className="mas-reschedule-fields">
                                  <label>
                                    New date
                                    <input
                                      type="date"
                                      min={todayIso}
                                      value={rsDate[row.session_id] ?? ''}
                                      onChange={(e) => setRsDate((m) => ({ ...m, [row.session_id]: e.target.value }))}
                                    />
                                  </label>
                                  <label>
                                    Venue (optional — if it changes)
                                    <input
                                      type="text"
                                      value={rsVenue[row.session_id] ?? ''}
                                      onChange={(e) => setRsVenue((m) => ({ ...m, [row.session_id]: e.target.value }))}
                                      placeholder={row.venue ?? 'Venue'}
                                    />
                                  </label>
                                </div>
                                {row.cp_examiner ? (
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem', fontSize: '0.85rem' }}>
                                    <input
                                      type="checkbox"
                                      checked={rsKeep[row.session_id] ?? true}
                                      onChange={(e) => setRsKeep((m) => ({ ...m, [row.session_id]: e.target.checked }))}
                                    />
                                    Keep the same examiner (untick to return it to the examiner pool)
                                  </label>
                                ) : (
                                  <p className="mas-status" style={{ marginTop: '0.5rem' }}>
                                    This session will return to the examiner pool for pickup on the new date.
                                  </p>
                                )}
                                <div style={{ marginTop: '0.6rem' }}>
                                  <button
                                    className="mas-btn-primary"
                                    onClick={() => rescheduleSession(row)}
                                    disabled={rsBusy === row.session_id || !rsDate[row.session_id]}
                                  >
                                    {rsBusy === row.session_id ? 'Setting new date…' : 'Set new date'}
                                  </button>
                                </div>
                                {rsError[row.session_id] && (
                                  <p className="mas-status mas-status-bad mas-admin-rowerror">
                                    Couldn’t reschedule: {rsError[row.session_id]}
                                  </p>
                                )}
                              </div>
                            )}

                            <div>
                              <h3 className="mas-detail-heading">Certificates</h3>
                              {certLoad[row.session_id] === 'loading' && (
                                <p className="mas-status">Loading…</p>
                              )}
                              {certLoad[row.session_id] === 'error' && (
                                <p className="mas-status mas-status-bad">Couldn’t load certificates.</p>
                              )}
                              {certLoad[row.session_id] === 'ready' &&
                                (certs[row.session_id]?.length ?? 0) === 0 && (
                                  <p className="mas-status">
                                    Certificates release once grading is complete and payment is cleared.
                                  </p>
                                )}
                              {certLoad[row.session_id] === 'ready' &&
                                (certs[row.session_id]?.length ?? 0) > 0 && (
                                  <ul className="mas-detail-list">
                                    {certs[row.session_id].map((ct) => (
                                      <li key={ct.serial}>
                                        <strong>{ct.candidate_name}</strong> · {pretty(ct.level)}{' '}
                                        <a
                                          href={`/certificate/${ct.serial}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          {ct.serial}
                                        </a>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                            </div>

                            {row.is_mine_booked && (
                              <div>
                                <h3 className="mas-detail-heading">Cancel session</h3>
                                {canCancel ? (
                                  <button
                                    className="mas-btn-ghost"
                                    onClick={() => setConfirmRow(row)}
                                    disabled={cancelBusy === row.session_id}
                                  >
                                    {cancelBusy === row.session_id ? 'Cancelling…' : 'Cancel session'}
                                  </button>
                                ) : (
                                  <p className="mas-status">
                                    {result ? 'This session has been cancelled.' : 'This session can no longer be cancelled.'}
                                  </p>
                                )}
                                {result && (
                                  <p className="mas-status mas-status-good mas-admin-rowerror">
                                    Session cancelled.{' '}
                                    {result.refund_due
                                      ? 'A refund will be arranged by the MAS office.'
                                      : result.within_72h
                                        ? 'Within 72 hours of the session — the fee is non-refundable.'
                                        : 'No payment had been made, so the invoice has been voided.'}
                                  </p>
                                )}
                                {cancelError[row.session_id] && (
                                  <p className="mas-status mas-status-bad mas-admin-rowerror">
                                    Couldn’t cancel this session: {cancelError[row.session_id]}
                                  </p>
                                )}
                              </div>
                            )}
                            {(audit[row.session_id]?.length ?? 0) > 0 && (
                              <div>
                                <h3 className="mas-detail-heading">Activity</h3>
                                <ul className="mas-detail-list">
                                  {audit[row.session_id].map((e) => (
                                    <li key={e.id}>
                                      <strong>{AUDIT_LABEL[e.action] ?? e.action}</strong>
                                      {auditSummary(e) ? ` · ${auditSummary(e)}` : ''}
                                      <span className="mas-cell-sub">
                                        {' · '}{e.actor_name || '—'}{' · '}{auditWhen(e.created_at)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirmRow && (
        <div
          className="mas-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-cancel-title"
          onClick={() => setConfirmRow(null)}
        >
          <div className="mas-modal" onClick={(e) => e.stopPropagation()}>
            <h2 id="confirm-cancel-title" className="mas-modal-title">Cancel this session?</h2>
            <p className="mas-modal-body">
              {confirmRow.venue || 'Assessment session'} · {prettyDate(confirmRow.scheduled_on)}
            </p>
            <p className="mas-modal-body">
              If the assessment is more than 72 hours away and payment was made, a refund
              will be arranged by the MAS office. Within 72 hours the fee is non-refundable.
              If an examiner has picked up the session, please contact them.
            </p>
            <div className="mas-modal-actions">
              <button className="mas-btn-ghost" onClick={() => setConfirmRow(null)}>Keep session</button>
              <button className="mas-btn-primary" onClick={() => cancelSession(confirmRow)}>
                Cancel session
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
