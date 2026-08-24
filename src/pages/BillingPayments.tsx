// Money IN — the invoice register for the finance roles.
//
// House law: dense table · Outstanding / Paid / Void tabs · tight single-line
// rows · inline record-payment detail row. Money OUT (payouts, refunds,
// reimbursements) lives in Billing · Payment vouchers, not here.
//   list ← list_billing_invoices() · record ← record_payment
//   View → /billing/invoice/:id · Receipt → /billing/receipt/:id (once paid)
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../styles/admin.css';

interface BillingInvoice {
  invoice_id: string;
  receipt_no: string | null;
  stage: string;
  status: string;
  total: number;
  paid_to_date: number;
  outstanding: number;
  session_id: string;
  venue: string | null;
  scheduled_on: string | null;
  session_status: string | null;
  bill_to_name: string | null;
  created_at: string;
  last_payment_ref: string | null;
  last_payment_method: string | null;
  last_payment_at: string | null;
}
interface Settlement { paid_to_date: number; invoice_total: number; status: string; fully_paid: boolean; }
type Load = 'loading' | 'ready' | 'error';
type Tab = 'outstanding' | 'paid' | 'void';

function bucket(inv: BillingInvoice): Tab {
  if (inv.status === 'paid') return 'paid';
  if (inv.status === 'void') return 'void';
  return 'outstanding';
}

const METHODS = [
  { value: 'transfer', label: 'Bank transfer' },
  { value: 'qr', label: 'QR / e-wallet' },
  { value: 'cash', label: 'Cash' },
];

const CSS = `
.mas-page.mas-page-wide { max-width: none !important; width: auto !important; margin-left: 0 !important; margin-right: 0 !important; }
.mas-tight th, .mas-tight td { padding: 0.35rem 0.6rem; white-space: nowrap; vertical-align: middle; }
.mas-tight tbody tr { line-height: 1.3; }
.mas-tight td.mas-billto-cell { white-space: normal; word-break: break-all; }
.mas-tight .mas-link { color: var(--mas-navy, #1E2752); text-decoration: underline; cursor: pointer; background: none; border: none; padding: 0; font: inherit; }
.mas-tight .mas-link:hover { text-decoration: none; }
.mas-tight .mas-link + .mas-link { margin-left: 0.6rem; }
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
function stageLabel(s: string): string {
  if (s === 'booked_prepay') return 'Booked';
  if (s === 'bonus_reconcile') return 'Bonus';
  return s.replace(/_/g, ' ');
}
function statusLabel(s: string): string {
  if (s === 'pro_forma') return 'Estimate';
  if (s === 'issued') return 'Awaiting payment';
  if (s === 'paid') return 'Paid';
  if (s === 'void') return 'Void';
  return s.replace(/_/g, ' ');
}
function methodLabel(m: string | null): string {
  if (!m) return '';
  if (m === 'transfer') return 'Transfer';
  if (m === 'qr') return 'QR';
  if (m === 'cash') return 'Cash';
  return m;
}
function openDoc(kind: 'invoice' | 'receipt', invoiceId: string, navigate: (to: string) => void) {
  navigate(`/billing/${kind}/${invoiceId}`);
}

export default function BillingPayments() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<BillingInvoice[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, { amount: string; method: string; reference: string }>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [settled, setSettled] = useState<Record<string, Settlement>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('outstanding');

  const fetchInvoices = useCallback(async () => {
    setLoad('loading');
    const { data, error } = await supabase.rpc('list_billing_invoices');
    if (error) { setLoad('error'); return; }
    setRows((data ?? []) as BillingInvoice[]);
    setLoad('ready');
  }, []);
  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { outstanding: 0, paid: 0, void: 0 };
    for (const inv of rows) c[bucket(inv)]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => rows.filter((inv) => bucket(inv) === tab), [rows, tab]);

  function form(id: string) { return forms[id] ?? { amount: '', method: 'transfer', reference: '' }; }
  function setForm(id: string, patch: Partial<{ amount: string; method: string; reference: string }>) {
    setForms((m) => ({ ...m, [id]: { ...form(id), ...patch } }));
  }
  function clearRowError(id: string) {
    setRowError((m) => { const n = { ...m }; delete n[id]; return n; });
  }

  async function recordPayment(inv: BillingInvoice) {
    const f = form(inv.invoice_id);
    const amount = Number(f.amount);
    clearRowError(inv.invoice_id);
    if (!Number.isFinite(amount) || amount <= 0) {
      setRowError((m) => ({ ...m, [inv.invoice_id]: 'Enter a payment amount greater than zero.' }));
      return;
    }
    setBusyId(inv.invoice_id);
    const { data, error } = await supabase.rpc('record_payment', {
      _invoice_id: inv.invoice_id, _amount: amount,
      _method: f.method, _reference: f.reference.trim() || null,
    });
    setBusyId(null);
    if (error) { setRowError((m) => ({ ...m, [inv.invoice_id]: error.message })); return; }
    const summary = (Array.isArray(data) ? data[0] : data) as Settlement | null;
    if (summary) setSettled((m) => ({ ...m, [inv.invoice_id]: summary }));
    setForms((m) => ({ ...m, [inv.invoice_id]: { amount: '', method: f.method, reference: '' } }));
    await fetchInvoices();
  }

  return (
    <section className="mas-page mas-page-wide">
      <style>{CSS}</style>
      <header className="mas-page-head">
        <p className="mas-eyebrow">Billing</p>
        <h1>Invoices &amp; payments</h1>
        <p className="mas-lede">
          Money in. Every assessment invoice with its settlement state. Record a
          payment against an invoice; once fully covered it flips to paid, mints a
          receipt and opens the session for examiner pickup. Money out — payouts,
          refunds, reimbursements — is raised in{' '}
          <Link to="/billing/vouchers">Payment vouchers</Link>.
        </p>
      </header>

      <div className="mas-admin-toolbar" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
        <button className="mas-btn-ghost" onClick={fetchInvoices} disabled={load === 'loading'}>
          Refresh
        </button>
        <div className="mas-tabs" role="tablist" style={{ display: 'flex', gap: '0.3rem' }}>
          <button role="tab" aria-selected={tab === 'outstanding'}
            className={tab === 'outstanding' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => { setTab('outstanding'); setExpanded(null); }}>
            Outstanding ({counts.outstanding})
          </button>
          <button role="tab" aria-selected={tab === 'paid'}
            className={tab === 'paid' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => { setTab('paid'); setExpanded(null); }}>
            Paid ({counts.paid})
          </button>
          <button role="tab" aria-selected={tab === 'void'}
            className={tab === 'void' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => { setTab('void'); setExpanded(null); }}>
            Void ({counts.void})
          </button>
        </div>
        {load === 'ready' && <span className="mas-admin-count">{filtered.length} shown</span>}
      </div>

      {load === 'loading' && <p className="mas-status">Loading invoices…</p>}
      {load === 'error' && <p className="mas-status mas-status-bad">Couldn’t load invoices. Refresh to try again.</p>}
      {load === 'ready' && filtered.length === 0 && (
        <p className="mas-status">
          {tab === 'outstanding' ? 'Nothing outstanding — every invoice is settled or void.'
            : tab === 'paid' ? 'No invoices paid yet.'
            : 'No void invoices.'}
        </p>
      )}

      {load === 'ready' && filtered.length > 0 && (
        <div className="mas-table-wrap">
          <table className="mas-table mas-tight">
            <thead>
              <tr>
                <th>Receipt</th><th>Stage</th><th>Status</th><th>Bill to</th>
                <th>Venue / date</th>
                <th className="mas-num">Total</th><th className="mas-num">Paid</th><th className="mas-num">Outstanding</th>
                <th>Payment ref</th>
                <th className="mas-table-actioncol">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => {
                const paid = inv.status === 'paid';
                const isUnissuedBonus = inv.stage === 'bonus_reconcile' && inv.status === 'pro_forma';
                const settleable = inv.status !== 'paid' && inv.status !== 'void' && !isUnissuedBonus;
                const summary = settled[inv.invoice_id];
                const f = form(inv.invoice_id);
                const isOpen = expanded === inv.invoice_id;
                return (
                  <Fragment key={inv.invoice_id}>
                    <tr className={isOpen ? 'is-open' : undefined}>
                      <td className="mas-cell-strong">{inv.receipt_no ?? '— (estimate)'}</td>
                      <td>{stageLabel(inv.stage)}</td>
                      <td>{statusLabel(inv.status)}</td>
                      <td className="mas-billto-cell">{inv.bill_to_name || '—'}</td>
                      <td>{inv.venue || 'Assessment session'} · {prettyDate(inv.scheduled_on)}</td>
                      <td className="mas-num">{money(inv.total)}</td>
                      <td className="mas-num">{money(inv.paid_to_date)}</td>
                      <td className="mas-num">{money(inv.outstanding)}</td>
                      <td>
                        {inv.last_payment_ref || inv.last_payment_method ? (
                          <>
                            {methodLabel(inv.last_payment_method)}
                            {inv.last_payment_ref ? ` · ${inv.last_payment_ref}` : ''}
                          </>
                        ) : (
                          <span className="mas-cell-sub">—</span>
                        )}
                      </td>
                      <td className="mas-table-actioncol">
                        {!isUnissuedBonus && (
                          <button type="button" className="mas-link" onClick={() => openDoc('invoice', inv.invoice_id, navigate)}>View</button>
                        )}
                        {paid && (
                          <button type="button" className="mas-link" onClick={() => openDoc('receipt', inv.invoice_id, navigate)}>Receipt</button>
                        )}
                        {settleable && (
                          <button
                            type="button" className="mas-link"
                            onClick={() => {
                              clearRowError(inv.invoice_id);
                              setExpanded((cur) => (cur === inv.invoice_id ? null : inv.invoice_id));
                            }}
                          >
                            {isOpen ? 'Close' : 'Record'}
                          </button>
                        )}
                        {isUnissuedBonus && <span className="mas-cell-sub">Create invoice first</span>}
                      </td>
                    </tr>

                    {isOpen && settleable && (
                      <tr className="mas-table-detailrow">
                        <td colSpan={10}>
                          <div className="mas-table-detail">
                            <div className="mas-grade-actions" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
                              <div className="mas-field mas-grade-field">
                                <label className="mas-field-label" htmlFor={`amount-${inv.invoice_id}`}>Amount (RM)</label>
                                <input
                                  id={`amount-${inv.invoice_id}`} className="mas-input"
                                  type="number" min="0" step="0.01" inputMode="decimal"
                                  value={f.amount}
                                  onChange={(e) => setForm(inv.invoice_id, { amount: e.target.value })}
                                  placeholder={Number(inv.outstanding).toFixed(2)}
                                />
                              </div>
                              <div className="mas-field mas-grade-field">
                                <label className="mas-field-label" htmlFor={`method-${inv.invoice_id}`}>Method</label>
                                <select
                                  id={`method-${inv.invoice_id}`} className="mas-select"
                                  value={f.method}
                                  onChange={(e) => setForm(inv.invoice_id, { method: e.target.value })}
                                >
                                  {METHODS.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
                                </select>
                              </div>
                              <div className="mas-field mas-grade-field">
                                <label className="mas-field-label" htmlFor={`ref-${inv.invoice_id}`}>Reference (optional)</label>
                                <input
                                  id={`ref-${inv.invoice_id}`} className="mas-input" type="text"
                                  value={f.reference}
                                  onChange={(e) => setForm(inv.invoice_id, { reference: e.target.value })}
                                  placeholder="Transaction / receipt ref"
                                />
                              </div>
                              <button
                                className="mas-btn-primary"
                                onClick={() => recordPayment(inv)}
                                disabled={busyId === inv.invoice_id}
                              >
                                {busyId === inv.invoice_id ? 'Recording…' : 'Record payment'}
                              </button>
                            </div>

                            {summary && (
                              <p className="mas-status mas-status-good mas-admin-rowerror">
                                Payment recorded — paid {money(summary.paid_to_date)} of {money(summary.invoice_total)}
                                {' · '}{statusLabel(summary.status)}
                                {summary.fully_paid ? ' · session opened for examiner pickup.' : '.'}
                              </p>
                            )}
                            {rowError[inv.invoice_id] && (
                              <p className="mas-status mas-status-bad mas-admin-rowerror">
                                Couldn’t record payment: {rowError[inv.invoice_id]}
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
