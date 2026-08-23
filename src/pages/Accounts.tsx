// #16 — Accounts / Session payouts, dense-table conversion.
//
// Money OUT no longer moves from this screen: each CD-4 component is raised as
// a DRAFT payment voucher, pre-filled from the session, and travels on to
// Billing · Payment vouchers for a second person to approve and pay.
//
// Wire:
//   list      ← list_sessions_overview() → session_id, status, venue,
//                scheduled_on, state, examiner_name, invoice_paid,
//                payout_recorded, …
//   breakdown ← session_payout_breakdown(_session_id) → {examiner_rm,
//                instructor_rm, hosting_rm, mas_retention_rm, total_rm,
//                candidate_count} per CD-4
//   payees    ← get_session_payout_targets(_session_id) → who is paid which
//                component, and whether it is payable at all
//   raised    ← list_payment_vouchers() (filtered to this session)
//   prepare   → prepare_session_payout_voucher(_session_id, _component, …)
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../styles/admin.css';

interface SessionOverview {
  session_id: string;
  status: string;
  venue: string | null;
  scheduled_on: string | null;
  state: string | null;
  instructor_name: string | null;
  centre_name: string | null;
  examiner_name: string | null;
  candidate_count: number;
  invited_count: number;
  invoice_status: string | null;
  invoice_paid: boolean;
  payout_recorded: boolean;
}
interface PayoutBreakdown {
  examiner_rm: number;
  instructor_rm: number;
  hosting_rm: number;
  mas_retention_rm: number;
  total_rm: number;
  candidate_count: number;
}
interface PayoutTarget {
  component: string;          // examiner | instructor | hosting
  category: string;           // examiner_payout | instructor_payout | hosting_payout
  amount: number;
  payee_profile_id: string | null;
  payee_name: string | null;
  payable: boolean;
}
interface SessionVoucher {
  voucher_id: string;
  voucher_no: string | null;
  category: string;
  status: string;
  amount: number;
  session_id: string | null;
}
type Load = 'loading' | 'ready' | 'error';
type Tab = 'awaiting' | 'paid' | 'archived';

const COMPONENT_LABEL: Record<string, string> = {
  examiner: 'Examiner', instructor: 'Instructor', hosting: 'Hosting',
};

const TERMINAL = new Set(['completed', 'closed', 'archived']);

const CSS = `
.mas-page.mas-page-wide { max-width: none !important; width: auto !important; margin-left: 0 !important; margin-right: 0 !important; }
.mas-tight th, .mas-tight td { padding: 0.35rem 0.6rem; white-space: nowrap; vertical-align: middle; }
.mas-tight tbody tr { line-height: 1.3; }
.mas-tight .mas-link { color: var(--mas-navy, #1E2752); text-decoration: underline; cursor: pointer; background: none; border: none; padding: 0; font: inherit; }
.mas-tight .mas-link:hover { text-decoration: none; }
.mas-tight .mas-link + .mas-link { margin-left: 0.6rem; }
.mas-payout-form { display:flex; gap:0.5rem; align-items:end; flex-wrap:wrap; }
.mas-payout-form label { display:flex; flex-direction:column; font-size:0.8rem; color:var(--mas-muted,#5b6472); }
.mas-payout-form input {
  font:inherit; padding:0.35rem 0.5rem; border:1px solid var(--mas-line,#e3e9f3); border-radius:6px;
}
.mas-cd4-grid {
  display: grid;
  grid-template-columns: max-content max-content;
  gap: 0.15rem 1.2rem;
  padding: 0.6rem 0.8rem;
  background: #f8fafd;
  border: 1px solid var(--mas-line, #e3e9f3);
  border-radius: 6px;
  margin: 0.4rem 0 0.6rem;
  font-size: 0.85rem;
  max-width: fit-content;
}
.mas-cd4-grid dt { color: var(--mas-muted, #5b6472); }
.mas-cd4-grid dd { margin: 0; color: var(--mas-navy, #1E2752); font-variant-numeric: tabular-nums; text-align: right; }
.mas-cd4-grid .is-total dt, .mas-cd4-grid .is-total dd { font-weight: 700; border-top: 1px solid var(--mas-line, #e3e9f3); padding-top: 0.2rem; margin-top: 0.15rem; }
.mas-cd4-note { color: var(--mas-muted, #5b6472); font-size: 0.78rem; margin: 0 0 0.5rem; }
`;

function money(n: number | string | null | undefined): string {
  return `RM ${Number(n ?? 0).toFixed(2)}`;
}
function prettyDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function pretty(s: string | null): string {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

type PayoutBucket = 'awaiting' | 'paid' | 'archived' | 'not_ready';
function payoutBucket(s: SessionOverview): PayoutBucket {
  if (s.status === 'archived') return 'archived';
  if (s.payout_recorded) return 'paid';
  if (s.invoice_paid && TERMINAL.has(s.status)) return 'awaiting';
  return 'not_ready';
}

export default function Accounts() {
  const [sessions, setSessions] = useState<SessionOverview[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [tab, setTab] = useState<Tab>('awaiting');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // CD-4 breakdown + payee cache — keyed by session_id
  const [breakdown, setBreakdown] = useState<Record<string, PayoutBreakdown | null>>({});
  const [targets, setTargets] = useState<Record<string, PayoutTarget[]>>({});
  const [vouchers, setVouchers] = useState<SessionVoucher[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowOk, setRowOk] = useState<Record<string, string>>({});

  const fetchSessions = useCallback(async () => {
    setLoad('loading');
    const { data, error } = await supabase.rpc('list_sessions_overview');
    if (error) { setLoad('error'); return; }
    setSessions((data ?? []) as SessionOverview[]);
    setLoad('ready');
  }, []);

  // Vouchers already raised, so a component is never prepared twice. Reuses the
  // register read rather than adding a per-session RPC.
  const fetchVouchers = useCallback(async () => {
    const { data } = await supabase.rpc('list_payment_vouchers');
    setVouchers(((data ?? []) as SessionVoucher[]).filter((v) => v.session_id != null));
  }, []);

  useEffect(() => { fetchSessions(); fetchVouchers(); }, [fetchSessions, fetchVouchers]);

  // Loads the CD-4 four-component payout breakdown for a session, caches it.
  // Called on expand; the examiner_rm value pre-fills the amount field.
  const loadBreakdown = useCallback(async (sessionId: string) => {
    if (breakdown[sessionId] != null) return;
    const { data } = await supabase.rpc('session_payout_breakdown', { _session_id: sessionId });
    // session_payout_breakdown returns a single row; supabase-js gives an array.
    const row = Array.isArray(data) ? data[0] : data;
    if (row == null) {
      setBreakdown((m) => ({ ...m, [sessionId]: null }));
      return;
    }
    const b: PayoutBreakdown = {
      examiner_rm:      Number(row.examiner_rm ?? 0),
      instructor_rm:    Number(row.instructor_rm ?? 0),
      hosting_rm:       Number(row.hosting_rm ?? 0),
      mas_retention_rm: Number(row.mas_retention_rm ?? 0),
      total_rm:         Number(row.total_rm ?? 0),
      candidate_count:  Number(row.candidate_count ?? 0),
    };
    setBreakdown((m) => ({ ...m, [sessionId]: b }));

    const { data: t } = await supabase.rpc('get_session_payout_targets', { _session_id: sessionId });
    setTargets((m) => ({
      ...m,
      [sessionId]: ((t ?? []) as PayoutTarget[]).map((x) => ({ ...x, amount: Number(x.amount ?? 0) })),
    }));
  }, [breakdown]);

  function toggleExpand(sessionId: string) {
    setExpanded((cur) => {
      const next = cur === sessionId ? null : sessionId;
      if (next) loadBreakdown(sessionId);
      return next;
    });
  }

  // Raises the DRAFT voucher for one CD-4 component. Money does not move here:
  // the voucher goes to Billing · Payment vouchers for approval and payment.
  async function prepareVoucher(s: SessionOverview, t: PayoutTarget) {
    const key = `${s.session_id}:${t.component}`;
    setBusy(key);
    setRowError((m) => { const n = { ...m }; delete n[s.session_id]; return n; });
    setRowOk((m) => { const n = { ...m }; delete n[s.session_id]; return n; });
    const { error } = await supabase.rpc('prepare_session_payout_voucher', {
      _session_id: s.session_id,
      _component: t.component,
      _amount: null,
      _memo: null,
    });
    setBusy(null);
    if (error) {
      setRowError((m) => ({ ...m, [s.session_id]: error.message }));
      return;
    }
    setRowOk((m) => ({
      ...m,
      [s.session_id]:
        `${COMPONENT_LABEL[t.component] ?? t.component} voucher for ${money(t.amount)} prepared — it now needs approval.`,
    }));
    await fetchVouchers();
  }

  // The vouchers already raised against a session, by category.
  function raisedFor(sessionId: string): Record<string, SessionVoucher> {
    const out: Record<string, SessionVoucher> = {};
    for (const v of vouchers) {
      if (v.session_id !== sessionId) continue;
      if (v.status === 'void') continue;
      out[v.category] = v;
    }
    return out;
  }

  const counts = useMemo(() => {
    const c = { awaiting: 0, paid: 0, archived: 0 };
    for (const s of sessions) {
      const b = payoutBucket(s);
      if (b !== 'not_ready') c[b]++;
    }
    return c;
  }, [sessions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions
      .filter((s) => payoutBucket(s) === tab)
      .filter((s) =>
        !q ||
        (s.venue ?? '').toLowerCase().includes(q) ||
        (s.state ?? '').toLowerCase().includes(q) ||
        (s.examiner_name ?? '').toLowerCase().includes(q) ||
        (s.centre_name ?? '').toLowerCase().includes(q));
  }, [sessions, tab, query]);

  return (
    <section className="mas-page mas-page-wide">
      <style>{CSS}</style>
      <header className="mas-page-head">
        <p className="mas-eyebrow">Accounts</p>
        <h1>Session payouts</h1>
        <p className="mas-lede">
          Raise the CD-4 payouts due on completed, invoiced sessions — examiner,
          instructor and hosting, each its own voucher. A session becomes actionable
          once its invoice has been paid. Money only moves once a second person
          approves and pays the voucher in{' '}
          <Link to="/billing/vouchers">Billing · Payment vouchers</Link>. Money in
          lives in <em>Billing · Invoices &amp; Payments</em>.
        </p>
      </header>

      <div className="mas-admin-toolbar" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
        <button className="mas-btn-ghost" onClick={fetchSessions} disabled={load === 'loading'}>
          Refresh
        </button>
        <div className="mas-tabs" role="tablist" style={{ display: 'flex', gap: '0.3rem' }}>
          <button role="tab" aria-selected={tab === 'awaiting'}
            className={tab === 'awaiting' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => { setTab('awaiting'); setExpanded(null); }}>
            Awaiting payout ({counts.awaiting})
          </button>
          <button role="tab" aria-selected={tab === 'paid'}
            className={tab === 'paid' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => { setTab('paid'); setExpanded(null); }}>
            Paid ({counts.paid})
          </button>
          <button role="tab" aria-selected={tab === 'archived'}
            className={tab === 'archived' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => { setTab('archived'); setExpanded(null); }}>
            Archived ({counts.archived})
          </button>
        </div>
        <input className="mas-input" type="text" value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search venue, state, examiner, centre"
          style={{ maxWidth: '22rem' }} />
        {load === 'ready' && <span className="mas-admin-count">{filtered.length} shown</span>}
      </div>

      {load === 'loading' && <p className="mas-status">Loading…</p>}
      {load === 'error' && <p className="mas-status mas-status-bad">Couldn’t load sessions. Refresh to try again.</p>}
      {load === 'ready' && filtered.length === 0 && (
        <p className="mas-status">
          {tab === 'awaiting' ? 'Nothing awaiting payout right now.'
            : tab === 'paid' ? 'No payouts paid out yet.'
            : 'No archived sessions.'}
        </p>
      )}

      {load === 'ready' && filtered.length > 0 && (
        <div className="mas-table-wrap">
          <table className="mas-table mas-tight">
            <thead>
              <tr>
                <th>Venue / date</th>
                <th>Centre</th>
                <th>Examiner</th>
                <th className="mas-num">Candidates</th>
                <th>Invoice</th>
                <th>Vouchers</th>
                <th className="mas-table-actioncol">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const isOpen = expanded === s.session_id;
                const canRaise = tab === 'awaiting' && s.invoice_paid;
                const b = breakdown[s.session_id];
                const raised = raisedFor(s.session_id);
                const raisedCount = Object.keys(raised).length;
                return (
                  <Fragment key={s.session_id}>
                    <tr className={isOpen ? 'is-open' : undefined}>
                      <td className="mas-cell-strong">
                        {(s.venue || pretty(s.state) || 'Assessment session')} · {prettyDate(s.scheduled_on)}
                      </td>
                      <td>{s.centre_name || <span className="mas-cell-sub">—</span>}</td>
                      <td>{s.examiner_name || <span className="mas-cell-sub">unassigned</span>}</td>
                      <td className="mas-num">{Number(s.candidate_count)}</td>
                      <td>{s.invoice_status ? pretty(s.invoice_status) : 'None'}</td>
                      <td>
                        {raisedCount > 0
                          ? `${raisedCount} raised`
                          : s.payout_recorded ? 'Paid' : <span className="mas-cell-sub">None</span>}
                      </td>
                      <td className="mas-table-actioncol">
                        <button className="mas-link" onClick={() => toggleExpand(s.session_id)}>
                          {isOpen ? 'Close' : canRaise ? 'Raise payouts' : 'Breakdown'}
                        </button>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="mas-table-detailrow">
                        <td colSpan={7}>
                          <div className="mas-table-detail">
                            <p className="mas-cell-sub" style={{ marginBottom: '0.3rem', fontWeight: 600, color: 'var(--mas-navy, #1E2752)' }}>
                              CD-4 payout breakdown{b != null ? ` — ${b.candidate_count} candidate${b.candidate_count === 1 ? '' : 's'}` : ''}
                            </p>
                            {b == null ? (
                              <p className="mas-status">Loading breakdown…</p>
                            ) : (
                              <>
                                <dl className="mas-cd4-grid">
                                  <dt>Examiner</dt>       <dd>{money(b.examiner_rm)}</dd>
                                  <dt>Instructor</dt>     <dd>{money(b.instructor_rm)}</dd>
                                  <dt>Hosting</dt>        <dd>{money(b.hosting_rm)}</dd>
                                  <dt>MAS retention</dt>  <dd>{money(b.mas_retention_rm)}</dd>
                                  <dt className="is-total">Total</dt><dd className="is-total">{money(b.total_rm)}</dd>
                                </dl>
                                <p className="mas-cd4-note">
                                  Per Manual Appendix D (CD-4). MAS retention is not a disbursement — it never
                                  becomes a voucher. Hosting is paid to the venue-provider of record (partner
                                  centre / independent instructor / MAS).
                                </p>
                              </>
                            )}

                            {canRaise ? (
                              <table className="mas-table mas-tight" style={{ marginTop: '0.2rem' }}>
                                <thead>
                                  <tr>
                                    <th>Component</th><th>Payee</th>
                                    <th className="mas-num">Amount</th><th>Voucher</th>
                                    <th className="mas-table-actioncol">Action</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(targets[s.session_id] ?? []).map((t) => {
                                    const existing = raised[t.category];
                                    const key = `${s.session_id}:${t.component}`;
                                    return (
                                      <tr key={t.component}>
                                        <td className="mas-cell-strong">{COMPONENT_LABEL[t.component] ?? t.component}</td>
                                        <td>{t.payee_name || <span className="mas-cell-sub">no payee of record</span>}</td>
                                        <td className="mas-num">{money(t.amount)}</td>
                                        <td>
                                          {existing
                                            ? `${existing.voucher_no ?? 'Draft'} · ${pretty(existing.status)}`
                                            : <span className="mas-cell-sub">not raised</span>}
                                        </td>
                                        <td className="mas-table-actioncol">
                                          {existing ? (
                                            <Link className="mas-link" to="/billing/vouchers">Open register</Link>
                                          ) : t.payable ? (
                                            <button className="mas-link"
                                              onClick={() => prepareVoucher(s, t)}
                                              disabled={busy === key}>
                                              {busy === key ? 'Preparing…' : 'Prepare voucher'}
                                            </button>
                                          ) : (
                                            <span className="mas-cell-sub">nothing payable</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                  {(targets[s.session_id] ?? []).length === 0 && (
                                    <tr><td colSpan={5} className="mas-status">Loading payees…</td></tr>
                                  )}
                                </tbody>
                              </table>
                            ) : (
                              <p className="mas-status">
                                {!s.invoice_paid ? 'Waiting for the session invoice to be paid.'
                                  : s.payout_recorded ? 'Payouts already paid for this session.'
                                  : 'Not yet actionable.'}
                              </p>
                            )}

                            {rowOk[s.session_id] && (
                              <p className="mas-status mas-status-good" style={{ marginTop: '0.4rem' }}>
                                {rowOk[s.session_id]}
                              </p>
                            )}
                            {rowError[s.session_id] && (
                              <p className="mas-status mas-status-bad" style={{ marginTop: '0.4rem' }}>
                                {rowError[s.session_id]}
                              </p>
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
    </section>
  );
}
