import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/admin.css';

interface Fee { code: string; label: string; default_amount: number; }
interface Row {
  centre_id: string; centre_name: string; state: string; poc_email: string;
  approved_at: string; invoice_id: string | null; invoice_status: string | null;
  total_amount: number | null; paid_amount: number | null; period_end: string | null;
  centre_status: string; valid_until: string | null;
}
interface Due { id: string; name: string; state: string; status: string; valid_until: string; days_left: number; }

const today = () => new Date().toISOString().slice(0, 10);
const inAYear = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); };
function dueWithin(valid_until: string | null, days = 60): boolean {
  if (!valid_until) return false;
  const diff = (new Date(valid_until).getTime() - Date.now()) / 86400000;
  return diff <= days;
}

export default function CentreBilling() {
  const [rows, setRows] = useState<Row[]>([]);
  const [fees, setFees] = useState<Fee[]>([]);
  const [due, setDue] = useState<Due[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [draft, setDraft] = useState<Record<string, { picked: Record<string, number>; start: string; end: string; note: string }>>({});
  const [pay, setPay] = useState<Record<string, { method: string; amount: string; reference: string; proof: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [r, f, d] = await Promise.all([
      supabase.rpc('list_centre_billing'),
      supabase.rpc('list_centre_fee_catalog'),
      supabase.rpc('list_centres_due_renewal', { _within_days: 60 }),
    ]);
    setRows((r.data ?? []) as Row[]);
    setFees((f.data ?? []) as Fee[]);
    setDue((d.data ?? []) as Due[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function draftFor(id: string) { return draft[id] ?? { picked: {}, start: today(), end: inAYear(), note: '' }; }
  function togglePick(id: string, fee: Fee) {
    const d = draftFor(id); const picked = { ...d.picked };
    if (fee.code in picked) delete picked[fee.code]; else picked[fee.code] = fee.default_amount;
    setDraft((p) => ({ ...p, [id]: { ...d, picked } }));
  }
  function setAmount(id: string, code: string, v: number) {
    const d = draftFor(id);
    setDraft((p) => ({ ...p, [id]: { ...d, picked: { ...d.picked, [code]: v } } }));
  }

  async function runLapse() {
    setBusy('lapse');
    const { data, error } = await supabase.rpc('lapse_expired_centres');
    setBusy(null);
    if (error) { alert(error.message); return; }
    alert(`${data ?? 0} expired listing(s) suspended.`);
    load();
  }
  async function inviteAdmin(centreId: string, email: string) {
    setBusy(centreId);
    const { error } = await supabase.rpc('invite_centre_admin', { _centre: centreId, _email: email });
    setBusy(null);
    if (error) { alert(error.message); return; }
    alert('Invitation recorded.');
  }
  async function createInvoice(centreId: string) {
    const d = draftFor(centreId);
    const items = Object.entries(d.picked).map(([code, amount]) => ({ label: fees.find((f) => f.code === code)?.label ?? code, amount }));
    if (items.length === 0) { alert('Pick at least one fee item.'); return; }
    setBusy(centreId);
    const { error } = await supabase.rpc('create_centre_invoice', { _centre: centreId, _period_start: d.start, _period_end: d.end, _items: items, _note: d.note || null });
    setBusy(null);
    if (error) { alert(error.message); return; }
    setDraft((p) => { const n = { ...p }; delete n[centreId]; return n; });
    load();
  }
  async function recordPayment(invoiceId: string) {
    const p = pay[invoiceId] ?? { method: 'transfer', amount: '', reference: '', proof: '' };
    if (!p.amount) { alert('Enter amount.'); return; }
    setBusy(invoiceId);
    const { error } = await supabase.rpc('record_centre_payment', { _invoice: invoiceId, _method: p.method, _amount: Number(p.amount), _reference: p.reference || null, _proof_url: p.proof || null });
    setBusy(null);
    if (error) { alert(error.message); return; }
    load();
  }
  async function markPaid(invoiceId: string) {
    setBusy(invoiceId);
    const { error } = await supabase.rpc('mark_centre_invoice_paid', { _invoice: invoiceId });
    setBusy(null);
    if (error) { alert(error.message); return; }
    load();
  }

  function invoiceForm(centreId: string, cta: string) {
    const d = draftFor(centreId);
    return (
      <>
        {fees.map((f) => {
          const on = f.code in d.picked;
          return (
            <div key={f.code} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <label className="mas-switch">
                <input type="checkbox" checked={on} onChange={() => togglePick(centreId, f)} />
                <span className="mas-switch-slider" /><span className="mas-switch-text">{f.label}</span>
              </label>
              {on && <input className="mas-input" type="number" style={{ width: '100%', maxWidth: '140px', minWidth: '90px' }} value={d.picked[f.code]} onChange={(e) => setAmount(centreId, f.code, Number(e.target.value))} />}
            </div>
          );
        })}
        <div className="mas-form-grid" style={{ marginTop: '0.75rem' }}>
          <div className="mas-field"><label className="mas-field-label">Listing from</label>
            <input className="mas-input" type="date" value={d.start} onChange={(e) => setDraft((pp) => ({ ...pp, [centreId]: { ...d, start: e.target.value } }))} /></div>
          <div className="mas-field"><label className="mas-field-label">Listing until</label>
            <input className="mas-input" type="date" value={d.end} onChange={(e) => setDraft((pp) => ({ ...pp, [centreId]: { ...d, end: e.target.value } }))} /></div>
        </div>
        <div className="mas-form-actions" style={{ marginTop: '0.75rem' }}>
          <button className="mas-btn-primary" disabled={busy === centreId} onClick={() => createInvoice(centreId)}>{busy === centreId ? 'Creating…' : cta}</button>
        </div>
      </>
    );
  }

  return (
    <section className="mas-page">
      <header className="mas-page-head mas-page-head-row">
        <div>
          <p className="mas-eyebrow">Accounts</p>
          <h1>Centre billing</h1>
          <p className="mas-lede">Invoice approved centres, record verified payments, and recognise them. Renew listings before they lapse.</p>
        </div>
        <div className="mas-page-actions">
          <button className="mas-btn-ghost" disabled={busy === 'lapse'} onClick={runLapse}>Run lapse check</button>
        </div>
      </header>

      {due.length > 0 && (
        <div className="mas-alert is-warning">
          <div className="mas-alert-body">
            <p className="mas-alert-title">{due.length} centre{due.length === 1 ? '' : 's'} due for renewal</p>
            <p className="mas-alert-text">
              {due.map((c) => `${c.name} (${c.days_left < 0 ? 'expired' : c.days_left + 'd'})`).join(' · ')}.
              Raise a renewal invoice below before the listing lapses.
            </p>
          </div>
        </div>
      )}

      {loading && <p className="mas-status">Loading…</p>}
      {!loading && rows.length === 0 && <p className="mas-status">No approved centres awaiting billing.</p>}

      {!loading && rows.map((r) => {
        const recognised = r.centre_status === 'recognized';
        const outstanding = r.invoice_status === 'outstanding';
        const noInvoice = !r.invoice_id;
        const renewable = recognised && dueWithin(r.valid_until) && !outstanding;
        const p = pay[r.invoice_id ?? ''] ?? { method: 'transfer', amount: '', reference: '', proof: '' };
        return (
          <div key={r.centre_id} className="mas-form" style={{ marginBottom: '0.9rem' }}>
            <div className="mas-form-cardhead">
              <div>
                {recognised ? <span className="mas-badge is-success">Recognised &amp; listed</span>
                  : outstanding ? <span className="mas-badge is-warning">Outstanding</span>
                  : <span className="mas-badge is-danger">New · needs invoicing</span>}
                {renewable && <span className="mas-badge is-warning" style={{ marginLeft: '0.4rem' }}>Renewal due</span>}
                <h2 style={{ marginTop: '0.5rem' }}>{r.centre_name}</h2>
              </div>
              <span className="mas-field-opt">{r.state}</span>
            </div>

            <div className="mas-form-actions" style={{ marginBottom: '1rem' }}>
              <button className="mas-btn-ghost" disabled={busy === r.centre_id} onClick={() => inviteAdmin(r.centre_id, r.poc_email)}>
                Invite centre admin ({r.poc_email})
              </button>
            </div>

            {noInvoice && !recognised && (<><p className="mas-field-label">Raise invoice</p>{invoiceForm(r.centre_id, 'Create invoice')}</>)}

            {outstanding && r.invoice_id && (
              <>
                <p className="mas-field-note">Invoice total RM {Number(r.total_amount).toFixed(2)} · recorded RM {Number(r.paid_amount ?? 0).toFixed(2)}</p>
                <div className="mas-form-grid" style={{ marginTop: '0.5rem' }}>
                  <div className="mas-field"><label className="mas-field-label">Payment method</label>
                    <select className="mas-select" value={p.method} onChange={(e) => setPay((pp) => ({ ...pp, [r.invoice_id!]: { ...p, method: e.target.value } }))}>
                      <option value="transfer">Bank transfer</option><option value="qr">QR pay</option><option value="cash">Cash</option>
                    </select></div>
                  <div className="mas-field"><label className="mas-field-label">Amount (RM)</label>
                    <input className="mas-input" type="number" value={p.amount} onChange={(e) => setPay((pp) => ({ ...pp, [r.invoice_id!]: { ...p, amount: e.target.value } }))} /></div>
                  <div className="mas-field"><label className="mas-field-label">Reference <span className="mas-field-opt">(optional)</span></label>
                    <input className="mas-input" value={p.reference} onChange={(e) => setPay((pp) => ({ ...pp, [r.invoice_id!]: { ...p, reference: e.target.value } }))} /></div>
                  <div className="mas-field"><label className="mas-field-label">Proof URL <span className="mas-field-opt">(optional)</span></label>
                    <input className="mas-input" value={p.proof} placeholder="Link to receipt" onChange={(e) => setPay((pp) => ({ ...pp, [r.invoice_id!]: { ...p, proof: e.target.value } }))} /></div>
                </div>
                <div className="mas-form-actions" style={{ marginTop: '0.75rem', gap: '0.6rem' }}>
                  <button className="mas-btn-ghost" disabled={busy === r.invoice_id} onClick={() => recordPayment(r.invoice_id!)}>Record payment</button>
                  <button className="mas-btn-success" disabled={busy === r.invoice_id} onClick={() => markPaid(r.invoice_id!)}>Mark fully paid &amp; recognise</button>
                </div>
              </>
            )}

            {recognised && !outstanding && (
              <p className="mas-status mas-status-good">
                Recognised and listed{r.valid_until ? ` · valid until ${r.valid_until}` : ''}.
              </p>
            )}

            {renewable && (<><p className="mas-field-label" style={{ marginTop: '0.75rem' }}>Raise renewal invoice</p>{invoiceForm(r.centre_id, 'Create renewal invoice')}</>)}
          </div>
        );
      })}
    </section>
  );
}
