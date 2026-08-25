// Session lifecycle — the end-to-end process checker for every assessment
// session, for the roles that carry the obligations rather than the work.
//
// My sessions answers "is my session on track?" and stops at certificates.
// This answers "has every obligation on this session been discharged, and if
// not, where is it stuck?" — carrying the money-IN leg (invoice, payment,
// receipt) and the money-OUT leg (vouchers raised, approved, paid) that the
// operator's tracker never had.
//
// House law: dense table, tabs, expandable detail row. No actions — this is a
// control surface, and every fix belongs on the screen that owns it, so each
// stuck row links to where the work actually happens.
//
// Wire:
//   list   ← list_session_lifecycle()
//   detail ← get_session_lifecycle_detail(_session_id)
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import CheckpointBar from '../components/CheckpointBar';
import '../styles/admin.css';

interface LifecycleRow {
  session_id: string;
  venue: string | null;
  state: string | null;
  scheduled_on: string | null;
  status: string;
  centre_name: string | null;
  booker_name: string | null;
  examiner_name: string | null;
  candidate_count: number;

  cp_created: boolean;
  cp_roster: boolean;
  cp_invoice_issued: boolean;
  cp_payment_collected: boolean;
  cp_receipt_issued: boolean;
  cp_examiner: boolean;
  cp_completed: boolean;
  cp_certificates: boolean;
  cp_payout_raised: boolean;
  cp_payout_approved: boolean;
  cp_payout_paid: boolean;

  stuck_at: string | null;
  steps_done: number;

  invoice_no: string | null;
  invoice_status: string | null;
  invoice_total: number | null;
  paid_to_date: number | null;
  receipt_no: string | null;

  voucher_count: number;
  voucher_total: number | null;
  voucher_paid: number | null;
}

interface DetailInvoice {
  invoice_id: string; invoice_no: string | null; stage: string; status: string;
  total: number; paid_to_date: number; issued_at: string | null; paid_at: string | null;
  receipts: Array<{ receipt_no: string; amount: number; method: string | null; reference: string | null; created_at: string }>;
}
interface DetailVoucher {
  voucher_id: string; voucher_no: string | null; category: string; status: string;
  amount: number; payee_name: string | null;
  prepared_by: string | null; prepared_at: string;
  approved_by: string | null; approved_at: string | null;
  paid_at: string | null; void_reason: string | null;
}
interface DetailAudit {
  action: string; detail: Record<string, unknown>; created_at: string; actor: string | null;
}
interface Detail {
  invoices: DetailInvoice[];
  vouchers: DetailVoucher[];
  audit: DetailAudit[];
}

type Load = 'loading' | 'ready' | 'error';
type Tab = 'open' | 'discharged' | 'closed';

const TOTAL_STEPS = 11;
const TERMINAL_STATUS = new Set(['cancelled', 'archived']);

// Where each unmet checkpoint gets fixed. A control surface that only tells you
// something is wrong wastes the reader's next click.
const FIX_ROUTE: Record<string, { to: string; label: string }> = {
  'Roster confirmed':          { to: '/assessments/schedule', label: 'Schedule assessment' },
  'Invoice issued':            { to: '/billing/payments',     label: 'Invoices & Payments' },
  'Payment collected':         { to: '/billing/payments',     label: 'Invoices & Payments' },
  'Receipt issued':            { to: '/billing/payments',     label: 'Invoices & Payments' },
  'Examiner assigned':         { to: '/assessments/examiners', label: 'Examiner registry' },
  'Session completed':         { to: '/assessments/grade',    label: 'Grading' },
  'Certificates issued':       { to: '/certificates',         label: 'Certificates' },
  'Payout vouchers raised':    { to: '/admin/accounts',       label: 'Session payouts' },
  'Payout vouchers approved':  { to: '/billing/vouchers',     label: 'Payment vouchers' },
  'Payout vouchers paid':      { to: '/billing/vouchers',     label: 'Payment vouchers' },
};

const CATEGORY_LABEL: Record<string, string> = {
  examiner_payout: 'Examiner', instructor_payout: 'Instructor', hosting_payout: 'Hosting',
  refund: 'Refund', reimbursement: 'Reimbursement', other: 'Other',
};

const CSS = `
.mas-page.mas-page-wide { max-width: none !important; width: auto !important; margin-left: 0 !important; margin-right: 0 !important; }
.mas-lc-table th, .mas-lc-table td { padding: 0.4rem 0.6rem; vertical-align: middle; }
.mas-lc-table tbody tr[data-clickable="1"] { cursor: pointer; }
.mas-lc-table tbody tr[data-clickable="1"]:hover { background: #f5f8fc; }
.mas-lc-table tbody tr.is-open { background: #eef3fb; }
.mas-lc-stuck { color: #b4690e; font-weight: 600; white-space: nowrap; }
.mas-lc-done { color: var(--mas-good, #1a7f4b); font-weight: 600; white-space: nowrap; }
.mas-lc-progress { white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--mas-muted, #5b6472); }
.mas-lc-leg { margin-bottom: 1rem; }
.mas-lc-leg h3 {
  font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--mas-muted, #5b6472); margin: 0 0 0.35rem;
}
.mas-lc-mini { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.mas-lc-mini th { text-align: left; font-weight: 600; color: var(--mas-muted, #5b6472); padding: 0.2rem 0.5rem 0.2rem 0; font-size: 0.78rem; }
.mas-lc-mini td { padding: 0.2rem 0.5rem 0.2rem 0; border-bottom: 1px solid var(--mas-line, #e3e9f3); }
.mas-lc-mini .num { text-align: right; font-variant-numeric: tabular-nums; }
.mas-lc-empty { color: var(--mas-muted, #5b6472); font-size: 0.85rem; margin: 0; }
.mas-lc-audit { list-style: none; margin: 0; padding: 0; font-size: 0.82rem; }
.mas-lc-audit li { padding: 0.15rem 0; color: var(--mas-muted, #5b6472); }
.mas-lc-audit strong { color: var(--mas-navy, #1E2752); font-weight: 600; }
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
  if (!s) return '—';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
function bucket(r: LifecycleRow): Tab {
  if (TERMINAL_STATUS.has(r.status)) return 'closed';
  return r.stuck_at == null ? 'discharged' : 'open';
}

export default function SessionLifecycle() {
  const [rows, setRows] = useState<LifecycleRow[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [tab, setTab] = useState<Tab>('open');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, Detail | null>>({});

  const fetchRows = useCallback(async () => {
    setLoad('loading');
    const { data, error } = await supabase.rpc('list_session_lifecycle');
    if (error) { setLoad('error'); return; }
    setRows((data ?? []) as LifecycleRow[]);
    setLoad('ready');
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const loadDetail = useCallback(async (sessionId: string) => {
    if (detail[sessionId] !== undefined) return;
    const { data, error } = await supabase.rpc('get_session_lifecycle_detail', { _session_id: sessionId });
    setDetail((m) => ({ ...m, [sessionId]: error ? null : (data as Detail) }));
  }, [detail]);

  function toggleExpand(sessionId: string) {
    setExpanded((cur) => {
      const next = cur === sessionId ? null : sessionId;
      if (next) loadDetail(sessionId);
      return next;
    });
  }

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { open: 0, discharged: 0, closed: 0 };
    for (const r of rows) c[bucket(r)]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => bucket(r) === tab)
      .filter((r) =>
        !q ||
        (r.venue ?? '').toLowerCase().includes(q) ||
        (r.centre_name ?? '').toLowerCase().includes(q) ||
        (r.booker_name ?? '').toLowerCase().includes(q) ||
        (r.examiner_name ?? '').toLowerCase().includes(q) ||
        (r.invoice_no ?? '').toLowerCase().includes(q) ||
        (r.stuck_at ?? '').toLowerCase().includes(q));
  }, [rows, tab, query]);

  // Outstanding money across the visible set — the number a controller wants
  // before drilling into any single row.
  const totals = useMemo(() => filtered.reduce(
    (acc, r) => ({
      owed: acc.owed + (Number(r.invoice_total ?? 0) - Number(r.paid_to_date ?? 0)),
      unpaidOut: acc.unpaidOut + (Number(r.voucher_total ?? 0) - Number(r.voucher_paid ?? 0)),
    }),
    { owed: 0, unpaidOut: 0 },
  ), [filtered]);

  const COLS = 8;

  return (
    <section className="mas-page mas-page-wide">
      <style>{CSS}</style>
      <header className="mas-page-head">
        <p className="mas-eyebrow">Oversight</p>
        <h1>Session lifecycle</h1>
        <p className="mas-lede">
          Every assessment session end to end — roster, invoice, payment, receipt,
          examiner, grading, certificates, and the payout vouchers that close the
          money out. <strong>Stuck at</strong> names the first obligation still
          outstanding, so a session that has stalled says where and links to the
          screen that fixes it.
        </p>
      </header>

      <div className="mas-admin-toolbar" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
        <button className="mas-btn-ghost" onClick={fetchRows} disabled={load === 'loading'}>Refresh</button>
        <div className="mas-tabs" role="tablist" style={{ display: 'flex', gap: '0.3rem' }}>
          <button role="tab" aria-selected={tab === 'open'}
            className={tab === 'open' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => { setTab('open'); setExpanded(null); }}>
            In progress ({counts.open})
          </button>
          <button role="tab" aria-selected={tab === 'discharged'}
            className={tab === 'discharged' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => { setTab('discharged'); setExpanded(null); }}>
            Fully discharged ({counts.discharged})
          </button>
          <button role="tab" aria-selected={tab === 'closed'}
            className={tab === 'closed' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => { setTab('closed'); setExpanded(null); }}>
            Cancelled &amp; archived ({counts.closed})
          </button>
        </div>
        <input className="mas-input" type="text" value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search venue, centre, instructor, examiner, invoice, stuck-at"
          style={{ maxWidth: '24rem' }} />
        {load === 'ready' && filtered.length > 0 && (
          <span className="mas-admin-count">
            {filtered.length} shown · {money(totals.owed)} owed in · {money(totals.unpaidOut)} due out
          </span>
        )}
      </div>

      {load === 'loading' && <p className="mas-status">Loading sessions…</p>}
      {load === 'error' && <p className="mas-status mas-status-bad">Couldn’t load the lifecycle view. Refresh to try again.</p>}
      {load === 'ready' && filtered.length === 0 && (
        <p className="mas-status">
          {tab === 'open' ? 'Nothing outstanding — every live session is fully discharged.'
            : tab === 'discharged' ? 'No fully discharged sessions yet.'
            : 'No cancelled or archived sessions.'}
        </p>
      )}

      {load === 'ready' && filtered.length > 0 && (
        <div className="mas-table-wrap">
          <table className="mas-table mas-lc-table">
            <thead>
              <tr>
                <th>Venue / date</th>
                <th>Centre</th>
                <th className="mas-num">Cand.</th>
                <th>Invoice</th>
                <th className="mas-num">Money in</th>
                <th className="mas-num">Money out</th>
                <th>Stuck at</th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isOpen = expanded === r.session_id;
                const d = detail[r.session_id];
                const fix = r.stuck_at ? FIX_ROUTE[r.stuck_at] : undefined;
                const steps = [
                  { key: 'created',    label: 'Created',              done: r.cp_created },
                  { key: 'roster',     label: 'Roster',               done: r.cp_roster },
                  { key: 'invoiced',   label: 'Invoice issued',       done: r.cp_invoice_issued },
                  { key: 'collected',  label: 'Payment collected',    done: r.cp_payment_collected },
                  { key: 'receipt',    label: 'Receipt issued',       done: r.cp_receipt_issued },
                  { key: 'examiner',   label: 'Examiner assigned',    done: r.cp_examiner },
                  { key: 'completed',  label: 'Completed',            done: r.cp_completed },
                  { key: 'certs',      label: 'Certificates issued',  done: r.cp_certificates },
                  { key: 'pv_raised',  label: 'Payouts raised',       done: r.cp_payout_raised },
                  { key: 'pv_appr',    label: 'Payouts approved',     done: r.cp_payout_approved },
                  { key: 'pv_paid',    label: 'Payouts paid',         done: r.cp_payout_paid },
                ];
                return (
                  <Fragment key={r.session_id}>
                    <tr className={isOpen ? 'is-open' : undefined}
                      data-clickable="1"
                      onClick={() => toggleExpand(r.session_id)}
                      aria-expanded={isOpen}>
                      <td>
                        <span className="mas-cell-stack">
                          <span className="mas-cell-strong">{r.venue || 'Assessment session'}</span>
                          <span className="mas-cell-sub">
                            {prettyDate(r.scheduled_on)} · {pretty(r.status)}
                          </span>
                        </span>
                      </td>
                      <td>{r.centre_name || <span className="mas-cell-sub">—</span>}</td>
                      <td className="mas-num">{r.candidate_count}</td>
                      <td className="mas-cell-strong">{r.invoice_no ?? <span className="mas-cell-sub">—</span>}</td>
                      <td className="mas-num">
                        {money(r.paid_to_date)}
                        <span className="mas-cell-sub"> / {money(r.invoice_total)}</span>
                      </td>
                      <td className="mas-num">
                        {r.voucher_count === 0
                          ? <span className="mas-cell-sub">none</span>
                          : <>{money(r.voucher_paid)}<span className="mas-cell-sub"> / {money(r.voucher_total)}</span></>}
                      </td>
                      <td>
                        {r.stuck_at
                          ? <span className="mas-lc-stuck">{r.stuck_at}</span>
                          : <span className="mas-lc-done">Discharged</span>}
                      </td>
                      <td>
                        <span className="mas-lc-progress">{r.steps_done}/{TOTAL_STEPS}</span>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="mas-table-detailrow" onClick={(e) => e.stopPropagation()}>
                        <td colSpan={COLS}>
                          <div className="mas-table-detail">
                            <div style={{ marginBottom: '0.8rem' }}>
                              <CheckpointBar steps={steps} />
                            </div>

                            {fix && (
                              <p className="mas-status" style={{ marginTop: 0 }}>
                                Outstanding: <strong>{r.stuck_at}</strong> — fix it in{' '}
                                <Link to={fix.to}>{fix.label}</Link>.
                              </p>
                            )}

                            <div className="mas-lc-leg">
                              <h3>Money in — invoices &amp; receipts</h3>
                              {d === undefined ? <p className="mas-lc-empty">Loading…</p>
                                : d === null ? <p className="mas-lc-empty">Couldn’t load the detail.</p>
                                : d.invoices.length === 0 ? <p className="mas-lc-empty">No invoice raised for this session.</p>
                                : (
                                  <table className="mas-lc-mini">
                                    <thead>
                                      <tr>
                                        <th>Invoice</th><th>Stage</th><th>Status</th>
                                        <th className="num">Total</th><th className="num">Paid</th><th>Receipts</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {d.invoices.map((inv) => (
                                        <tr key={inv.invoice_id}>
                                          <td>{inv.invoice_no ?? '— (estimate)'}</td>
                                          <td>{pretty(inv.stage)}</td>
                                          <td>{pretty(inv.status)}</td>
                                          <td className="num">{money(inv.total)}</td>
                                          <td className="num">{money(inv.paid_to_date)}</td>
                                          <td>
                                            {inv.receipts.length === 0
                                              ? <span className="mas-cell-sub">—</span>
                                              : inv.receipts.map((rc) => rc.receipt_no).join(', ')}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                            </div>

                            <div className="mas-lc-leg">
                              <h3>Money out — payment vouchers</h3>
                              {d === undefined ? <p className="mas-lc-empty">Loading…</p>
                                : d === null ? <p className="mas-lc-empty">Couldn’t load the detail.</p>
                                : d.vouchers.length === 0 ? <p className="mas-lc-empty">No voucher raised for this session yet.</p>
                                : (
                                  <table className="mas-lc-mini">
                                    <thead>
                                      <tr>
                                        <th>Voucher</th><th>For</th><th>Payee</th>
                                        <th className="num">Amount</th><th>Status</th>
                                        <th>Prepared / approved</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {d.vouchers.map((v) => (
                                        <tr key={v.voucher_id}>
                                          <td>{v.voucher_no ?? '— (draft)'}</td>
                                          <td>{CATEGORY_LABEL[v.category] ?? pretty(v.category)}</td>
                                          <td>{v.payee_name ?? '—'}</td>
                                          <td className="num">{money(v.amount)}</td>
                                          <td>
                                            {pretty(v.status)}
                                            {v.status === 'void' && v.void_reason ? ` — ${v.void_reason}` : ''}
                                          </td>
                                          <td>
                                            {v.prepared_by ?? '—'}
                                            {v.approved_by ? ` → ${v.approved_by}` : ''}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                            </div>

                            {d && d.audit.length > 0 && (
                              <div className="mas-lc-leg">
                                <h3>Audit trail</h3>
                                <ul className="mas-lc-audit">
                                  {d.audit.slice(0, 12).map((a, i) => (
                                    <li key={i}>
                                      <strong>{pretty(a.action)}</strong>
                                      {a.actor ? ` · ${a.actor}` : ''}
                                      {' · '}{prettyDate(a.created_at)}
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
    </section>
  );
}
