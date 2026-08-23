// Money OUT — the payment voucher register.
//
// House law: dense table · Outstanding (draft + approved) / Paid / Void tabs ·
// inline + prepare add-row · per-row approve / pay / void / print.
//
// Wire:
//   list     ← list_payment_vouchers()
//   refunds  ← list_refunds_due()  → prepare_refund_voucher(_invoice_id)
//   prepare  → prepare_payment_voucher(category, amount, payee…, memo)
//   approve  → approve_payment_voucher(id)   [allocates the PV number]
//   pay      → pay_payment_voucher(id, method, reference)
//   void     → void_payment_voucher(id, reason)
//   print    → /billing/voucher/:id (PrintableDocument mode="voucher")
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import '../styles/admin.css';

interface Voucher {
  voucher_id: string;
  voucher_no: string | null;
  category: string;
  status: string;
  amount: number;
  currency: string;
  payee_name: string | null;
  payee_profile_id: string | null;
  session_id: string | null;
  venue: string | null;
  scheduled_on: string | null;
  invoice_id: string | null;
  invoice_no: string | null;
  method: string | null;
  reference: string | null;
  memo: string | null;
  prepared_by_name: string | null;
  prepared_at: string;
  approved_by_name: string | null;
  approved_at: string | null;
  paid_at: string | null;
  void_reason: string | null;
  can_approve: boolean;
}
interface RefundDue {
  invoice_id: string; receipt_no: string | null; session_id: string;
  venue: string | null; scheduled_on: string | null;
  bill_to_id: string | null; bill_to_name: string | null;
  paid_amount: number; refunded: number; refund_due: number;
}
type Load = 'loading' | 'ready' | 'error';
type Tab = 'outstanding' | 'paid' | 'void';

const CATEGORIES = [
  { value: 'examiner_payout',   label: 'Examiner payout' },
  { value: 'instructor_payout', label: 'Instructor payout' },
  { value: 'hosting_payout',    label: 'Hosting payout' },
  { value: 'refund',            label: 'Refund' },
  { value: 'reimbursement',     label: 'Reimbursement' },
  { value: 'other',             label: 'Other' },
];
const METHODS = [
  { value: 'transfer', label: 'Bank transfer' },
  { value: 'qr', label: 'QR / e-wallet' },
  { value: 'cash', label: 'Cash' },
];

const CSS = `
.mas-page.mas-page-wide { max-width: none !important; width: auto !important; margin-left: 0 !important; margin-right: 0 !important; }
.mas-tight th, .mas-tight td { padding: 0.35rem 0.6rem; white-space: nowrap; vertical-align: middle; }
.mas-tight tbody tr { line-height: 1.3; }
.mas-tight .mas-link { color: var(--mas-navy, #1E2752); text-decoration: underline; cursor: pointer; background: none; border: none; padding: 0; font: inherit; }
.mas-tight .mas-link:hover { text-decoration: none; }
.mas-tight .mas-link + .mas-link { margin-left: 0.6rem; }
.mas-addrow td { background: #f5f8fc; }
.mas-addrow-fields { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.mas-addrow-fields select, .mas-addrow-fields input[type=text], .mas-addrow-fields input[type=number] {
  font: inherit; padding: 0.35rem 0.5rem; border: 1px solid var(--mas-line, #e3e9f3); border-radius: 6px;
}
.mas-voucher-form { display: flex; gap: 0.5rem; align-items: end; flex-wrap: wrap; }
.mas-voucher-form label { display: flex; flex-direction: column; font-size: 0.8rem; color: var(--mas-muted, #5b6472); }
.mas-voucher-form input, .mas-voucher-form select {
  font: inherit; padding: 0.35rem 0.5rem; border: 1px solid var(--mas-line, #e3e9f3); border-radius: 6px;
}
.mas-voucher-meta { display: flex; gap: 1.4rem; flex-wrap: wrap; font-size: 0.82rem; color: var(--mas-muted, #5b6472); margin-bottom: 0.5rem; }
.mas-voucher-meta strong { color: var(--mas-navy, #1E2752); font-weight: 600; }
`;

function money(n: number | string | null | undefined, currency = 'MYR'): string {
  const v = Number(n ?? 0).toFixed(2);
  return currency === 'MYR' ? `RM ${v}` : `${currency} ${v}`;
}
function prettyDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function categoryLabel(c: string): string {
  return CATEGORIES.find((x) => x.value === c)?.label ?? c.replace(/_/g, ' ');
}
function statusLabel(s: string): string {
  if (s === 'draft') return 'Draft — awaiting approval';
  if (s === 'approved') return 'Approved — ready to pay';
  if (s === 'paid') return 'Paid';
  if (s === 'void') return 'Void';
  return s;
}
function bucket(v: Voucher): Tab {
  if (v.status === 'paid') return 'paid';
  if (v.status === 'void') return 'void';
  return 'outstanding';
}

export default function PaymentVouchers() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();

  const canPrepare = hasRole('finance_officer') || hasRole('system_admin') || hasRole('chairperson');

  const [rows, setRows] = useState<Voucher[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [tab, setTab] = useState<Tab>('outstanding');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  // inline + prepare add-row
  const [nCategory, setNCategory] = useState('reimbursement');
  const [nPayee, setNPayee] = useState('');
  const [nAmount, setNAmount] = useState('');
  const [nMemo, setNMemo] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // per-row pay / void inputs
  const [payForm, setPayForm] = useState<Record<string, { method: string; reference: string }>>({});
  const [voidReason, setVoidReason] = useState<Record<string, string>>({});

  // refunds due — the obligations that still need a voucher raised
  const [refunds, setRefunds] = useState<RefundDue[]>([]);
  const [refundLoad, setRefundLoad] = useState<Load>('loading');
  const [refundBusy, setRefundBusy] = useState<string | null>(null);
  const [refundError, setRefundError] = useState<Record<string, string>>({});

  const fetchVouchers = useCallback(async () => {
    setLoad('loading');
    const { data, error } = await supabase.rpc('list_payment_vouchers');
    if (error) { setLoad('error'); return; }
    setRows((data ?? []) as Voucher[]);
    setLoad('ready');
  }, []);

  const fetchRefunds = useCallback(async () => {
    setRefundLoad('loading');
    const { data, error } = await supabase.rpc('list_refunds_due');
    if (error) { setRefundLoad('error'); return; }
    setRefunds((data ?? []) as RefundDue[]);
    setRefundLoad('ready');
  }, []);

  const refreshAll = useCallback(() => { fetchVouchers(); fetchRefunds(); }, [fetchVouchers, fetchRefunds]);
  useEffect(() => { refreshAll(); }, [refreshAll]);

  function clearRowError(id: string) {
    setRowError((m) => { const n = { ...m }; delete n[id]; return n; });
  }
  function pay(id: string) { return payForm[id] ?? { method: 'transfer', reference: '' }; }

  async function prepare() {
    const amount = Number(nAmount);
    setAddError(null);
    if (!nPayee.trim()) { setAddError('Name the payee.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setAddError('Enter an amount greater than zero.'); return; }
    setAddBusy(true);
    const { error } = await supabase.rpc('prepare_payment_voucher', {
      _category: nCategory,
      _amount: amount,
      _payee_profile_id: null,
      _payee_name: nPayee.trim(),
      _session_id: null,
      _invoice_id: null,
      _memo: nMemo.trim() || null,
      _currency: 'MYR',
    });
    setAddBusy(false);
    if (error) { setAddError(error.message); return; }
    setNPayee(''); setNAmount(''); setNMemo('');
    setNotice('Voucher prepared as a draft — it needs a second person to approve it.');
    await fetchVouchers();
  }

  async function approve(v: Voucher) {
    clearRowError(v.voucher_id);
    setBusyId(v.voucher_id);
    const { data, error } = await supabase.rpc('approve_payment_voucher', { _voucher_id: v.voucher_id });
    setBusyId(null);
    if (error) { setRowError((m) => ({ ...m, [v.voucher_id]: error.message })); return; }
    const res = (Array.isArray(data) ? data[0] : data) as { voucher_no?: string } | null;
    setNotice(`Voucher approved${res?.voucher_no ? ` — ${res.voucher_no}` : ''}. It can now be paid.`);
    await fetchVouchers();
  }

  async function payVoucher(v: Voucher) {
    const f = pay(v.voucher_id);
    clearRowError(v.voucher_id);
    setBusyId(v.voucher_id);
    const { error } = await supabase.rpc('pay_payment_voucher', {
      _voucher_id: v.voucher_id,
      _method: f.method,
      _reference: f.reference.trim() || null,
    });
    setBusyId(null);
    if (error) { setRowError((m) => ({ ...m, [v.voucher_id]: error.message })); return; }
    setNotice(`${v.voucher_no ?? 'Voucher'} paid — ${money(v.amount, v.currency)} recorded in the payout ledger.`);
    setExpanded(null);
    await refreshAll();
  }

  async function voidVoucher(v: Voucher) {
    const reason = (voidReason[v.voucher_id] ?? '').trim();
    clearRowError(v.voucher_id);
    if (!reason) { setRowError((m) => ({ ...m, [v.voucher_id]: 'A void needs a reason.' })); return; }
    setBusyId(v.voucher_id);
    const { error } = await supabase.rpc('void_payment_voucher', {
      _voucher_id: v.voucher_id, _reason: reason,
    });
    setBusyId(null);
    if (error) { setRowError((m) => ({ ...m, [v.voucher_id]: error.message })); return; }
    setNotice(`${v.voucher_no ?? 'Draft voucher'} voided.`);
    setExpanded(null);
    await refreshAll();
  }

  async function prepareRefund(r: RefundDue) {
    setRefundError((m) => { const n = { ...m }; delete n[r.invoice_id]; return n; });
    setRefundBusy(r.invoice_id);
    const { error } = await supabase.rpc('prepare_refund_voucher', {
      _invoice_id: r.invoice_id, _amount: null, _memo: null,
    });
    setRefundBusy(null);
    if (error) { setRefundError((m) => ({ ...m, [r.invoice_id]: error.message })); return; }
    setNotice('Refund voucher prepared as a draft — it needs approval before it can be paid.');
    setTab('outstanding');
    await refreshAll();
  }

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { outstanding: 0, paid: 0, void: 0 };
    for (const v of rows) c[bucket(v)]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((v) => bucket(v) === tab)
      .filter((v) =>
        !q ||
        (v.voucher_no ?? '').toLowerCase().includes(q) ||
        (v.payee_name ?? '').toLowerCase().includes(q) ||
        (v.memo ?? '').toLowerCase().includes(q) ||
        categoryLabel(v.category).toLowerCase().includes(q));
  }, [rows, tab, query]);

  const COLS = 9;

  return (
    <section className="mas-page mas-page-wide">
      <style>{CSS}</style>
      <header className="mas-page-head">
        <p className="mas-eyebrow">Billing</p>
        <h1>Payment vouchers</h1>
        <p className="mas-lede">
          Money out. Every disbursement — examiner, instructor and hosting payouts,
          refunds, reimbursements — is raised here as a voucher, approved by a second
          person, then paid. Approval allocates the voucher number; paying writes the
          payout ledger. Money in lives in <em>Invoices &amp; Payments</em>.
        </p>
      </header>

      <div className="mas-admin-toolbar" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
        <button className="mas-btn-ghost" onClick={refreshAll} disabled={load === 'loading'}>Refresh</button>
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
        <input className="mas-input" type="text" value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search voucher no, payee, memo, category"
          style={{ maxWidth: '22rem' }} />
        {load === 'ready' && <span className="mas-admin-count">{filtered.length} shown</span>}
      </div>

      {notice && <p className="mas-status mas-status-good">{notice}</p>}

      <div className="mas-table-wrap">
        <table className="mas-table mas-tight">
          <thead>
            <tr>
              <th>Voucher</th>
              <th>Category</th>
              <th>Payee</th>
              <th className="mas-num">Amount</th>
              <th>Status</th>
              <th>Against</th>
              <th>Prepared by</th>
              <th>Approved by</th>
              <th className="mas-table-actioncol">Actions</th>
            </tr>
          </thead>
          <tbody>
            {canPrepare && tab === 'outstanding' && (
              <tr className="mas-addrow">
                <td colSpan={COLS}>
                  <div className="mas-addrow-fields">
                    <select value={nCategory} onChange={(e) => setNCategory(e.target.value)}>
                      {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <input type="text" value={nPayee} placeholder="Payee name"
                      onChange={(e) => setNPayee(e.target.value)} style={{ minWidth: '14rem' }} />
                    <input type="number" min="0" step="0.01" inputMode="decimal" value={nAmount}
                      placeholder="Amount (RM)" onChange={(e) => setNAmount(e.target.value)}
                      style={{ width: '9rem' }} />
                    <input type="text" value={nMemo} placeholder="What is this for?"
                      onChange={(e) => setNMemo(e.target.value)} style={{ minWidth: '16rem', flex: '1 1 auto' }} />
                    <button className="mas-btn-primary mas-btn-compact" onClick={prepare} disabled={addBusy}>
                      {addBusy ? 'Preparing…' : '+ Prepare voucher'}
                    </button>
                  </div>
                  {addError && <p className="mas-status mas-status-bad mas-admin-rowerror">{addError}</p>}
                  <p className="mas-cell-sub" style={{ marginTop: '0.35rem' }}>
                    Session payouts are raised pre-filled from <em>Examiner payouts</em>; refunds from the
                    list below. Use this row for reimbursements and other disbursements.
                  </p>
                </td>
              </tr>
            )}

            {load === 'loading' && <tr><td colSpan={COLS} className="mas-status">Loading vouchers…</td></tr>}
            {load === 'error' && (
              <tr><td colSpan={COLS} className="mas-status mas-status-bad">Couldn’t load vouchers. Refresh to try again.</td></tr>
            )}
            {load === 'ready' && filtered.length === 0 && (
              <tr><td colSpan={COLS} className="mas-status">
                {tab === 'outstanding' ? 'No vouchers waiting on approval or payment.'
                  : tab === 'paid' ? 'No vouchers paid yet.'
                  : 'No voided vouchers.'}
              </td></tr>
            )}

            {load === 'ready' && filtered.map((v) => {
              const isOpen = expanded === v.voucher_id;
              const canPay = canPrepare && v.status === 'approved';
              const canVoid = (canPrepare || v.can_approve) && (v.status === 'draft' || v.status === 'approved');
              const f = pay(v.voucher_id);
              return (
                <Fragment key={v.voucher_id}>
                  <tr className={isOpen ? 'is-open' : undefined}>
                    <td className="mas-cell-strong">{v.voucher_no ?? '— (draft)'}</td>
                    <td>{categoryLabel(v.category)}</td>
                    <td>{v.payee_name || <span className="mas-cell-sub">—</span>}</td>
                    <td className="mas-num">{money(v.amount, v.currency)}</td>
                    <td>{statusLabel(v.status)}</td>
                    <td>
                      {v.invoice_no ? `Invoice ${v.invoice_no}`
                        : v.session_id ? `${v.venue || 'Session'} · ${prettyDate(v.scheduled_on)}`
                        : <span className="mas-cell-sub">—</span>}
                    </td>
                    <td>{v.prepared_by_name || <span className="mas-cell-sub">—</span>}</td>
                    <td>{v.approved_by_name || <span className="mas-cell-sub">—</span>}</td>
                    <td className="mas-table-actioncol">
                      {v.can_approve && (
                        <button type="button" className="mas-link"
                          onClick={() => approve(v)} disabled={busyId === v.voucher_id}>
                          Approve
                        </button>
                      )}
                      {(canPay || canVoid) && (
                        <button type="button" className="mas-link"
                          onClick={() => { clearRowError(v.voucher_id); setExpanded((c) => (c === v.voucher_id ? null : v.voucher_id)); }}>
                          {isOpen ? 'Close' : canPay ? 'Pay' : 'Void'}
                        </button>
                      )}
                      {v.voucher_no && (
                        <button type="button" className="mas-link"
                          onClick={() => navigate(`/billing/voucher/${v.voucher_id}`)}>
                          Print
                        </button>
                      )}
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="mas-table-detailrow">
                      <td colSpan={COLS}>
                        <div className="mas-table-detail">
                          <div className="mas-voucher-meta">
                            <span>Prepared <strong>{prettyDate(v.prepared_at)}</strong></span>
                            {v.approved_at && <span>Approved <strong>{prettyDate(v.approved_at)}</strong></span>}
                            {v.memo && <span>Memo: <strong>{v.memo}</strong></span>}
                          </div>

                          {canPay && (
                            <div className="mas-voucher-form">
                              <label>Method
                                <select value={f.method}
                                  onChange={(e) => setPayForm((m) => ({ ...m, [v.voucher_id]: { ...pay(v.voucher_id), method: e.target.value } }))}>
                                  {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                                </select>
                              </label>
                              <label>Reference
                                <input type="text" value={f.reference}
                                  placeholder="Transaction / payout proof"
                                  onChange={(e) => setPayForm((m) => ({ ...m, [v.voucher_id]: { ...pay(v.voucher_id), reference: e.target.value } }))}
                                  style={{ width: '16rem' }} />
                              </label>
                              <button className="mas-btn-primary mas-btn-compact"
                                onClick={() => payVoucher(v)} disabled={busyId === v.voucher_id}>
                                {busyId === v.voucher_id ? 'Paying…' : `Pay ${money(v.amount, v.currency)}`}
                              </button>
                            </div>
                          )}

                          {canVoid && (
                            <div className="mas-voucher-form" style={{ marginTop: canPay ? '0.6rem' : 0 }}>
                              <label>Void reason
                                <input type="text" value={voidReason[v.voucher_id] ?? ''}
                                  placeholder="Why is this voucher being cancelled?"
                                  onChange={(e) => setVoidReason((m) => ({ ...m, [v.voucher_id]: e.target.value }))}
                                  style={{ width: '20rem' }} />
                              </label>
                              <button className="mas-btn-ghost mas-btn-compact"
                                onClick={() => voidVoucher(v)} disabled={busyId === v.voucher_id}>
                                Void voucher
                              </button>
                            </div>
                          )}

                          {rowError[v.voucher_id] && (
                            <p className="mas-status mas-status-bad mas-admin-rowerror">{rowError[v.voucher_id]}</p>
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

      {/* ---- Refund obligations still needing a voucher ---- */}
      <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--mas-line)', paddingTop: '1.5rem' }}>
        <header className="mas-page-head">
          <p className="mas-eyebrow">Refunds</p>
          <h2>Refunds due</h2>
          <p className="mas-lede">
            Sessions cancelled more than 72 hours ahead with a payment already taken.
            Raise a refund voucher; it joins the register above for approval and payment.
            A refund already covered by a draft or approved voucher drops off this list.
          </p>
        </header>

        {refundLoad === 'loading' && <p className="mas-status">Loading refunds…</p>}
        {refundLoad === 'error' && <p className="mas-status mas-status-bad">Couldn’t load refunds. Refresh to try again.</p>}
        {refundLoad === 'ready' && refunds.length === 0 && <p className="mas-status">No refunds are due.</p>}

        {refundLoad === 'ready' && refunds.length > 0 && (
          <div className="mas-table-wrap">
            <table className="mas-table mas-tight">
              <thead>
                <tr>
                  <th>Invoice</th><th>Venue / date</th><th>Refund to</th>
                  <th className="mas-num">Paid</th><th className="mas-num">Refunded</th><th className="mas-num">Refund due</th>
                  <th className="mas-table-actioncol">Actions</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((r) => (
                  <Fragment key={r.invoice_id}>
                    <tr>
                      <td className="mas-cell-strong">{r.receipt_no ?? '— (no invoice no)'}</td>
                      <td>{r.venue || 'Assessment session'} · {prettyDate(r.scheduled_on)}</td>
                      <td>{r.bill_to_name || '—'}</td>
                      <td className="mas-num">{money(r.paid_amount)}</td>
                      <td className="mas-num">{money(r.refunded)}</td>
                      <td className="mas-num">{money(r.refund_due)}</td>
                      <td className="mas-table-actioncol">
                        <button type="button" className="mas-link"
                          onClick={() => navigate(`/billing/invoice/${r.invoice_id}`)}>View invoice</button>
                        {canPrepare && (
                          <button type="button" className="mas-link"
                            onClick={() => prepareRefund(r)} disabled={refundBusy === r.invoice_id}>
                            {refundBusy === r.invoice_id ? 'Preparing…' : 'Prepare refund voucher'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {refundError[r.invoice_id] && (
                      <tr className="mas-table-errorrow">
                        <td colSpan={7} className="mas-status mas-status-bad">{refundError[r.invoice_id]}</td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
