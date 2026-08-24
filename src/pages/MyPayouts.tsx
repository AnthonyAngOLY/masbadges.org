// "My payouts" — the payee's own view of money MAS owes or has paid them.
//
// Read-only. Reuses list_payment_vouchers(), which already returns a payee's
// own rows under RLS; this page filters to the signed-in profile.
//
// Drafts are deliberately NOT shown. A draft voucher is a proposal the finance
// desk has not had approved yet — surfacing it would read as a promise to pay.
// A payee sees a payout once it is APPROVED (authorised, awaiting transfer)
// and after it is PAID. Voided vouchers never reach them either.
//
// Wire:
//   list  ← list_payment_vouchers()  (filtered client-side to payee_profile_id)
//   print → /billing/voucher/:id     (get_voucher_document allows the payee)
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  payee_profile_id: string | null;
  session_id: string | null;
  venue: string | null;
  scheduled_on: string | null;
  invoice_no: string | null;
  method: string | null;
  reference: string | null;
  memo: string | null;
  approved_at: string | null;
  paid_at: string | null;
}
type Load = 'loading' | 'ready' | 'error';
type Tab = 'awaiting' | 'paid';

const CATEGORY_LABEL: Record<string, string> = {
  examiner_payout: 'Examiner payout',
  instructor_payout: 'Instructor payout',
  hosting_payout: 'Hosting payout',
  refund: 'Refund',
  reimbursement: 'Reimbursement',
  other: 'Other',
};

const CSS = `
.mas-page.mas-page-wide { max-width: none !important; width: auto !important; margin-left: 0 !important; margin-right: 0 !important; }
.mas-tight th, .mas-tight td { padding: 0.35rem 0.6rem; white-space: nowrap; vertical-align: middle; }
.mas-tight tbody tr { line-height: 1.3; }
.mas-tight .mas-link { color: var(--mas-navy, #1E2752); text-decoration: underline; cursor: pointer; background: none; border: none; padding: 0; font: inherit; }
.mas-tight .mas-link:hover { text-decoration: none; }
.mas-payout-total {
  display: inline-block; padding: 0.45rem 0.8rem; border-radius: 6px;
  background: #f8fafd; border: 1px solid var(--mas-line, #e3e9f3);
  font-size: 0.9rem; color: var(--mas-navy, #1E2752);
}
.mas-payout-total strong { font-variant-numeric: tabular-nums; }
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

export default function MyPayouts() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<Voucher[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [tab, setTab] = useState<Tab>('awaiting');

  const fetchVouchers = useCallback(async () => {
    setLoad('loading');
    const { data, error } = await supabase.rpc('list_payment_vouchers');
    if (error) { setLoad('error'); return; }
    setRows((data ?? []) as Voucher[]);
    setLoad('ready');
  }, []);

  useEffect(() => { fetchVouchers(); }, [fetchVouchers]);

  // Mine only, and only what has been authorised. A finance officer viewing
  // this page sees their own payouts, not the whole register.
  const mine = useMemo(
    () => rows.filter(
      (v) => v.payee_profile_id != null
        && v.payee_profile_id === user?.id
        && (v.status === 'approved' || v.status === 'paid'),
    ),
    [rows, user?.id],
  );

  const counts = useMemo(() => ({
    awaiting: mine.filter((v) => v.status === 'approved').length,
    paid: mine.filter((v) => v.status === 'paid').length,
  }), [mine]);

  const filtered = useMemo(
    () => mine.filter((v) => (tab === 'awaiting' ? v.status === 'approved' : v.status === 'paid')),
    [mine, tab],
  );

  const total = useMemo(
    () => filtered.reduce((sum, v) => sum + Number(v.amount ?? 0), 0),
    [filtered],
  );

  return (
    <section className="mas-page mas-page-wide">
      <style>{CSS}</style>
      <header className="mas-page-head">
        <p className="mas-eyebrow">Billing</p>
        <h1>My payouts</h1>
        <p className="mas-lede">
          What MAS owes you and what has already been paid — assessment payouts,
          refunds and reimbursements raised in your name. A payout appears here once
          it has been approved; approval is the authorisation to pay, and the transfer
          follows. Print any voucher for your own records.
        </p>
      </header>

      <div className="mas-admin-toolbar" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
        <button className="mas-btn-ghost" onClick={fetchVouchers} disabled={load === 'loading'}>Refresh</button>
        <div className="mas-tabs" role="tablist" style={{ display: 'flex', gap: '0.3rem' }}>
          <button role="tab" aria-selected={tab === 'awaiting'}
            className={tab === 'awaiting' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => setTab('awaiting')}>
            Awaiting payment ({counts.awaiting})
          </button>
          <button role="tab" aria-selected={tab === 'paid'}
            className={tab === 'paid' ? 'mas-btn-primary mas-btn-compact' : 'mas-btn-ghost mas-btn-compact'}
            onClick={() => setTab('paid')}>
            Paid ({counts.paid})
          </button>
        </div>
        {load === 'ready' && filtered.length > 0 && (
          <span className="mas-payout-total">
            {tab === 'awaiting' ? 'Due to you' : 'Paid to date'}: <strong>{money(total)}</strong>
          </span>
        )}
      </div>

      {load === 'loading' && <p className="mas-status">Loading…</p>}
      {load === 'error' && <p className="mas-status mas-status-bad">Couldn’t load your payouts. Refresh to try again.</p>}
      {load === 'ready' && filtered.length === 0 && (
        <p className="mas-status">
          {tab === 'awaiting'
            ? 'Nothing is awaiting payment to you right now.'
            : 'No payouts have been paid to you yet.'}
        </p>
      )}

      {load === 'ready' && filtered.length > 0 && (
        <div className="mas-table-wrap">
          <table className="mas-table mas-tight">
            <thead>
              <tr>
                <th>Voucher</th>
                <th>For</th>
                <th>Against</th>
                <th className="mas-num">Amount</th>
                <th>{tab === 'paid' ? 'Paid on' : 'Approved on'}</th>
                {tab === 'paid' && <th>Method / ref</th>}
                <th className="mas-table-actioncol">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.voucher_id}>
                  <td className="mas-cell-strong">{v.voucher_no ?? '—'}</td>
                  <td>{CATEGORY_LABEL[v.category] ?? v.category.replace(/_/g, ' ')}</td>
                  <td>
                    {v.invoice_no ? `Invoice ${v.invoice_no}`
                      : v.session_id ? `${v.venue || 'Session'} · ${prettyDate(v.scheduled_on)}`
                      : <span className="mas-cell-sub">{v.memo || '—'}</span>}
                  </td>
                  <td className="mas-num">{money(v.amount, v.currency)}</td>
                  <td>{prettyDate(tab === 'paid' ? v.paid_at : v.approved_at)}</td>
                  {tab === 'paid' && (
                    <td>
                      {v.method || v.reference
                        ? `${v.method ?? ''}${v.method && v.reference ? ' · ' : ''}${v.reference ?? ''}`
                        : <span className="mas-cell-sub">—</span>}
                    </td>
                  )}
                  <td className="mas-table-actioncol">
                    <button type="button" className="mas-link"
                      onClick={() => navigate(`/billing/voucher/${v.voucher_id}`)}>
                      Print
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
