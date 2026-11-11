// Store — FO ops queue.
//
// Finance officers and sysadmins work store orders through their lifecycle:
//   submitted → invoiced → paid → shipped
// with cancel available up through invoiced (buyers can only cancel while
// submitted; FO can cancel until paid). Backed by S2 RPCs:
//
//   list       ← list_store_orders(_status?)
//   invoice    ← fo_invoice_store_order(_order_id)
//   mark paid  ← fo_mark_store_order_paid(_order_id, _payment_ref)
//   ship       ← fo_ship_store_order(_order_id, _tracking_ref)
//   cancel     ← cancel_store_order(_order_id, _reason)
//
// Dense-table house style matching Accounts.tsx: tight rows, plain-text
// links, inline expansion for actions requiring input (paid needs reference,
// ship needs tracking, cancel needs reason). Governance can view via
// is_store_staff() gating on the list RPC, but only finance_officer /
// system_admin can act — can_operate_store() gates every mutation server-side.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import '../styles/admin.css';

type OrderStatus = 'submitted' | 'invoiced' | 'paid' | 'shipped' | 'cancelled';
type Load = 'loading' | 'ready' | 'error';
type Tab = 'submitted' | 'invoiced' | 'paid' | 'shipped' | 'cancelled';

interface OrderItem {
  label: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

interface StoreOrder {
  order_id: string;
  order_no: string;
  status: OrderStatus;
  created_at: string;
  total_amount: number | null;
  buyer_name: string | null;
  buyer_email: string | null;
  recipient_name: string | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  note: string | null;
  invoice_no: string | null;
  invoice_amount: number | null;
  invoiced_at: string | null;
  paid_at: string | null;
  payment_ref: string | null;
  fulfilled_at: string | null;
  tracking: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  items: OrderItem[] | null;
}

type Mode = 'view' | 'paid' | 'ship' | 'cancel';

const CSS = `
.mas-page.mas-page-wide { max-width: none !important; width: auto !important; margin-left: 0 !important; margin-right: 0 !important; }
.mas-tight th, .mas-tight td { padding: 0.35rem 0.6rem; vertical-align: middle; }
.mas-tight tbody tr { line-height: 1.3; }
.mas-tight .mas-link { color: var(--mas-navy, #1E2752); text-decoration: underline; cursor: pointer; background: none; border: none; padding: 0; font: inherit; }
.mas-tight .mas-link:hover { text-decoration: none; }
.mas-tight .mas-link + .mas-link { margin-left: 0.6rem; }
.mas-tight .mas-link.is-danger { color: var(--mas-red, #C62026); }

.mas-order-detail { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 1.5rem; padding: 0.5rem 0.2rem; }
@media (max-width: 900px) { .mas-order-detail { grid-template-columns: 1fr; } }
.mas-order-detail h4 { font-size: 0.85rem; margin: 0 0 0.3rem; color: var(--mas-navy, #1E2752); text-transform: uppercase; letter-spacing: 0.04em; }
.mas-order-detail p, .mas-order-detail li { font-size: 0.88rem; margin: 0 0 0.2rem; color: var(--mas-navy, #1E2752); }
.mas-order-detail ul { list-style: none; padding: 0; margin: 0; }
.mas-order-detail li { display: flex; justify-content: space-between; padding: 0.2rem 0; border-bottom: 1px dashed var(--mas-line, #e3e9f3); }
.mas-order-detail li:last-child { border-bottom: 0; }
.mas-order-address { color: var(--mas-navy, #1E2752); line-height: 1.4; }
.mas-order-history p { color: var(--mas-muted, #5b6472); }

.mas-order-form { display: flex; gap: 0.5rem; align-items: end; flex-wrap: wrap; margin-top: 0.6rem; padding: 0.6rem; background: #f8fafd; border-radius: 6px; }
.mas-order-form label { display: flex; flex-direction: column; font-size: 0.78rem; color: var(--mas-muted, #5b6472); }
.mas-order-form input, .mas-order-form textarea {
  font: inherit; padding: 0.35rem 0.5rem; border: 1px solid var(--mas-line, #e3e9f3); border-radius: 6px;
}
.mas-order-total { font-weight: 700; padding-top: 0.4rem; border-top: 2px solid var(--mas-navy, #1E2752); margin-top: 0.4rem !important; display: flex; justify-content: space-between; }

.mas-store-status {
  display: inline-block; font-size: 0.72rem; padding: 0.15rem 0.55rem; border-radius: 999px;
  text-transform: uppercase; letter-spacing: 0.04em;
  background: #eef1f8; color: var(--mas-navy, #1E2752);
}
.mas-store-status.is-invoiced { background: #fef4d9; color: #7a5b00; }
.mas-store-status.is-paid     { background: #dff3e6; color: #0d5928; }
.mas-store-status.is-shipped  { background: var(--mas-navy, #1E2752); color: #fff; }
.mas-store-status.is-cancelled{ background: #f3d5d6; color: var(--mas-red, #C62026); }
`;

function money(n: number | string | null | undefined): string {
  return `RM ${Number(n ?? 0).toFixed(2)}`;
}
function prettyDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function prettyDateTime(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function pretty(s: string | null): string {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function StoreOrders() {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [tab, setTab] = useState<Tab>('submitted');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('view');

  // action-specific input state
  const [paymentRef, setPaymentRef] = useState('');
  const [trackingRef, setTrackingRef] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  // is_store_staff() lets governance SEE this queue, but can_operate_store()
  // lets only finance_officer / system_admin act. Without this, a chairperson
  // got live-looking buttons that every RPC then refused.
  const { hasRole } = useAuth();
  const canOperate = hasRole('finance_officer') || hasRole('system_admin');

  const [busy, setBusy] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, { ok: boolean; text: string }>>({});

  const fetchOrders = useCallback(async () => {
    setLoad('loading');
    // Pass null to get every status back; client-side tabbing keeps counts live.
    const { data, error } = await supabase.rpc('list_store_orders', { _status: null });
    if (error) { setLoad('error'); return; }
    setOrders((data ?? []) as StoreOrder[]);
    setLoad('ready');
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  function openDetail(orderId: string, m: Mode = 'view') {
    setExpanded(orderId);
    setMode(m);
    setPaymentRef(''); setTrackingRef(''); setCancelReason('');
    setRowMsg((prev) => { const n = { ...prev }; delete n[orderId]; return n; });
  }
  function closeDetail() {
    setExpanded(null);
    setMode('view');
  }

  async function callRpc(o: StoreOrder, fn: string, args: Record<string, unknown>, successMsg: string) {
    setBusy(o.order_id);
    setRowMsg((m) => { const n = { ...m }; delete n[o.order_id]; return n; });
    const { error } = await supabase.rpc(fn, args);
    setBusy(null);
    if (error) {
      setRowMsg((m) => ({ ...m, [o.order_id]: { ok: false, text: error.message } }));
      return;
    }
    setRowMsg((m) => ({ ...m, [o.order_id]: { ok: true, text: successMsg } }));
    setMode('view');
    fetchOrders();
  }

  async function actInvoice(o: StoreOrder) {
    await callRpc(o, 'fo_invoice_store_order', { _order_id: o.order_id },
      `Invoice generated for ${money(o.total_amount)}.`);
  }
  async function actMarkPaid(o: StoreOrder) {
    await callRpc(o, 'fo_mark_store_order_paid',
      { _order_id: o.order_id, _payment_ref: paymentRef.trim() || null },
      `Marked paid${paymentRef.trim() ? ` (ref: ${paymentRef.trim()})` : ''}.`);
  }
  async function actShip(o: StoreOrder) {
    await callRpc(o, 'fo_ship_store_order',
      { _order_id: o.order_id, _tracking_ref: trackingRef.trim() || null },
      `Shipped${trackingRef.trim() ? ` (tracking: ${trackingRef.trim()})` : ''}.`);
  }
  async function actCancel(o: StoreOrder) {
    await callRpc(o, 'cancel_store_order',
      { _order_id: o.order_id, _reason: cancelReason.trim() || null },
      'Order cancelled; stock restored.');
  }

  const counts = useMemo(() => {
    const c = { submitted: 0, invoiced: 0, paid: 0, shipped: 0, cancelled: 0 };
    for (const o of orders) c[o.status]++;
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders
      .filter((o) => o.status === tab)
      .filter((o) =>
        !q ||
        (o.order_no ?? '').toLowerCase().includes(q) ||
        (o.buyer_name ?? '').toLowerCase().includes(q) ||
        (o.buyer_email ?? '').toLowerCase().includes(q) ||
        (o.recipient_name ?? '').toLowerCase().includes(q) ||
        (o.invoice_no ?? '').toLowerCase().includes(q));
  }, [orders, tab, query]);

  const TABS: { id: Tab; label: string }[] = [
    { id: 'submitted', label: `Submitted (${counts.submitted})` },
    { id: 'invoiced',  label: `Awaiting payment (${counts.invoiced})` },
    { id: 'paid',      label: `Ready to ship (${counts.paid})` },
    { id: 'shipped',   label: `Shipped (${counts.shipped})` },
    { id: 'cancelled', label: `Cancelled (${counts.cancelled})` },
  ];

  return (
    <section className="mas-page mas-page-wide">
      <style>{CSS}</style>
      <header className="mas-page-head">
        <p className="mas-eyebrow">Billing</p>
        <h1>Store orders</h1>
        <p className="mas-lede">
          Move orders through their lifecycle: submitted → invoiced → paid →
          shipped. Buyers see status updates immediately; stock is decremented
          on submit and restored on cancel. Payment collection is off-platform;
          record the reference here once received.
        </p>
      </header>

      <div className="mas-admin-toolbar" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
        <button className="mas-btn-ghost" onClick={fetchOrders} disabled={load === 'loading'}>
          Refresh
        </button>
        <div className="mas-tabs" role="tablist" style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id}
              className={tab === t.id ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
              onClick={() => { setTab(t.id); closeDetail(); }}>
              {t.label}
            </button>
          ))}
        </div>
        <input className="mas-input" type="text" value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search order no, buyer, recipient, invoice"
          style={{ maxWidth: '22rem' }} />
        {load === 'ready' && <span className="mas-admin-count">{filtered.length} shown</span>}
      </div>

      {load === 'loading' && <p className="mas-status">Loading orders…</p>}
      {load === 'error' && <p className="mas-status mas-status-bad">Couldn’t load orders. Refresh to try again.</p>}
      {load === 'ready' && filtered.length === 0 && (
        <p className="mas-status">
          {tab === 'submitted' ? 'No new orders awaiting invoicing.'
            : tab === 'invoiced' ? 'No orders awaiting payment.'
            : tab === 'paid' ? 'Nothing ready to ship right now.'
            : tab === 'shipped' ? 'No shipped orders yet.'
            : 'No cancelled orders.'}
        </p>
      )}

      {load === 'ready' && filtered.length > 0 && (
        <div className="mas-table-wrap">
          <table className="mas-table mas-tight">
            <thead>
              <tr>
                <th>Order</th>
                <th>Buyer</th>
                <th>Recipient</th>
                <th className="mas-num">Amount</th>
                <th>Placed</th>
                <th>Status</th>
                <th className="mas-table-actioncol">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const isOpen = expanded === o.order_id;
                const isBusy = busy === o.order_id;
                return (
                  <Fragment key={o.order_id}>
                    <tr className={isOpen ? 'is-open' : undefined}>
                      <td className="mas-cell-strong">
                        {o.order_no}
                        {o.invoice_no && <span className="mas-cell-sub"> · {o.invoice_no}</span>}
                      </td>
                      <td>
                        {o.buyer_name || <span className="mas-cell-sub">—</span>}
                        {o.buyer_email && <div className="mas-cell-sub">{o.buyer_email}</div>}
                      </td>
                      <td>
                        {o.recipient_name || <span className="mas-cell-sub">—</span>}
                        {o.city && <div className="mas-cell-sub">{o.city}{o.state ? ', ' + pretty(o.state) : ''}</div>}
                      </td>
                      <td className="mas-num">{money(o.invoice_amount ?? o.total_amount)}</td>
                      <td>{prettyDate(o.created_at)}</td>
                      <td><span className={`mas-store-status is-${o.status}`}>{pretty(o.status)}</span></td>
                      <td className="mas-table-actioncol">
                        {o.status === 'submitted' && (
                          <>
                            <button className="mas-link" onClick={() => openDetail(o.order_id, 'view')}>
                              {isOpen ? 'Close' : 'View'}
                            </button>
                            {canOperate && (
                              <>
                                <button className="mas-link" onClick={() => actInvoice(o)} disabled={isBusy}>
                                  {isBusy ? '…' : 'Invoice'}
                                </button>
                                <button className="mas-link is-danger" onClick={() => openDetail(o.order_id, 'cancel')}>
                                  Cancel
                                </button>
                              </>
                            )}
                          </>
                        )}
                        {o.status === 'invoiced' && (
                          <>
                            <button className="mas-link" onClick={() => openDetail(o.order_id, 'view')}>
                              {isOpen ? 'Close' : 'View'}
                            </button>
                            {canOperate && (
                              <>
                                <button className="mas-link" onClick={() => openDetail(o.order_id, 'paid')}>
                                  Mark paid
                                </button>
                                <button className="mas-link is-danger" onClick={() => openDetail(o.order_id, 'cancel')}>
                                  Cancel
                                </button>
                              </>
                            )}
                          </>
                        )}
                        {o.status === 'paid' && (
                          <>
                            <button className="mas-link" onClick={() => openDetail(o.order_id, 'view')}>
                              {isOpen ? 'Close' : 'View'}
                            </button>
                            {canOperate && (
                              <button className="mas-link" onClick={() => openDetail(o.order_id, 'ship')}>
                                Ship
                              </button>
                            )}
                          </>
                        )}
                        {(o.status === 'shipped' || o.status === 'cancelled') && (
                          <button className="mas-link" onClick={() => openDetail(o.order_id, 'view')}>
                            {isOpen ? 'Close' : 'View'}
                          </button>
                        )}
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="mas-table-detailrow">
                        <td colSpan={7}>
                          <div className="mas-order-detail">
                            <div>
                              <h4>Items</h4>
                              <ul>
                                {(o.items ?? []).map((it, i) => (
                                  <li key={i}>
                                    <span>{it.qty} × {it.label}</span>
                                    <span>{money(it.line_total)}</span>
                                  </li>
                                ))}
                                <li className="mas-order-total">
                                  <span>Total</span>
                                  <span>{money(o.invoice_amount ?? o.total_amount)}</span>
                                </li>
                              </ul>
                              {o.note && (
                                <p style={{ marginTop: '0.6rem' }}>
                                  <strong>Buyer note:</strong> {o.note}
                                </p>
                              )}
                            </div>

                            <div>
                              <h4>Ship to</h4>
                              <p className="mas-order-address">
                                {o.recipient_name}<br />
                                {o.address_line1}<br />
                                {o.address_line2 && <>{o.address_line2}<br /></>}
                                {o.city} {o.postcode}<br />
                                {pretty(o.state)}
                              </p>
                              <p style={{ marginTop: '0.4rem' }}>
                                <strong>Phone:</strong> {o.phone || '—'}<br />
                                <strong>Email:</strong> {o.email || '—'}
                              </p>
                            </div>

                            <div className="mas-order-history">
                              <h4>Timeline</h4>
                              <p><strong>Placed:</strong> {prettyDateTime(o.created_at)}</p>
                              {o.invoiced_at && <p><strong>Invoiced:</strong> {prettyDateTime(o.invoiced_at)}</p>}
                              {o.paid_at && <p><strong>Paid:</strong> {prettyDateTime(o.paid_at)}{o.payment_ref ? ` · ${o.payment_ref}` : ''}</p>}
                              {o.fulfilled_at && <p><strong>Shipped:</strong> {prettyDateTime(o.fulfilled_at)}{o.tracking ? ` · ${o.tracking}` : ''}</p>}
                              {o.cancelled_at && <p><strong>Cancelled:</strong> {prettyDateTime(o.cancelled_at)}{o.cancel_reason ? ` · ${o.cancel_reason}` : ''}</p>}
                            </div>
                          </div>

                          {mode === 'paid' && (
                            <div className="mas-order-form">
                              <label>Payment reference (optional)
                                <input type="text" value={paymentRef}
                                  onChange={(e) => setPaymentRef(e.target.value)}
                                  placeholder="e.g. bank ref, receipt no."
                                  style={{ width: '20rem' }} />
                              </label>
                              <button className="mas-btn-primary mas-btn-compact"
                                onClick={() => actMarkPaid(o)} disabled={isBusy}>
                                {isBusy ? 'Recording…' : 'Confirm paid'}
                              </button>
                              <button className="mas-btn-ghost mas-btn-compact" onClick={() => setMode('view')} disabled={isBusy}>
                                Cancel
                              </button>
                            </div>
                          )}

                          {mode === 'ship' && (
                            <div className="mas-order-form">
                              <label>Tracking reference (optional)
                                <input type="text" value={trackingRef}
                                  onChange={(e) => setTrackingRef(e.target.value)}
                                  placeholder="courier tracking no."
                                  style={{ width: '20rem' }} />
                              </label>
                              <button className="mas-btn-primary mas-btn-compact"
                                onClick={() => actShip(o)} disabled={isBusy}>
                                {isBusy ? 'Marking shipped…' : 'Confirm shipped'}
                              </button>
                              <button className="mas-btn-ghost mas-btn-compact" onClick={() => setMode('view')} disabled={isBusy}>
                                Cancel
                              </button>
                            </div>
                          )}

                          {mode === 'cancel' && (
                            <div className="mas-order-form">
                              <label style={{ flex: 1, minWidth: '20rem' }}>Cancellation reason (optional)
                                <textarea rows={2} value={cancelReason}
                                  onChange={(e) => setCancelReason(e.target.value)}
                                  placeholder="Reason for cancellation" />
                              </label>
                              <button className="mas-btn-primary mas-btn-compact"
                                onClick={() => actCancel(o)} disabled={isBusy}
                                style={{ background: 'var(--mas-red, #C62026)' }}>
                                {isBusy ? 'Cancelling…' : 'Confirm cancel'}
                              </button>
                              <button className="mas-btn-ghost mas-btn-compact" onClick={() => setMode('view')} disabled={isBusy}>
                                Back
                              </button>
                            </div>
                          )}

                          {rowMsg[o.order_id] && (
                            <p className={`mas-status ${rowMsg[o.order_id].ok ? 'mas-status-good' : 'mas-status-bad'}`}
                              style={{ marginTop: '0.6rem' }}>
                              {rowMsg[o.order_id].text}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                    {!isOpen && rowMsg[o.order_id] && (
                      <tr className="mas-table-errorrow">
                        <td colSpan={7}>
                          <p className={`mas-status ${rowMsg[o.order_id].ok ? 'mas-status-good' : 'mas-status-bad'}`}>
                            {rowMsg[o.order_id].text}
                          </p>
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
