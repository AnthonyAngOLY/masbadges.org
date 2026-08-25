// Finance-governance process overview for a single assessment session.
// Renders the phased lifecycle returned by get_session_process_overview():
//   Setup → Money-in (booked) → Assessment → Money-in (bonus, if any) →
//   Certificates → Money-out (if any) → Reconciled.
// Fetched lazily on row-expand in MySessions.tsx and shown ONLY to the finance
// tier (the RPC returns null for everyone else, so this never renders for them).
// Conditional phases (bonus, money-out) appear only when applicable.

export interface ProcessOverview {
  session_id: string;
  session_status: string;
  reconciled: boolean;
  setup: { created: boolean; roster: boolean; candidate_count: number; examiner: boolean };
  money_in_booked: {
    applicable: boolean; invoice_no: string | null; issued: boolean; paid: boolean;
    total: number | null; paid_at: string | null; receipt_no: string | null; receipt_amount: number | null;
  };
  assessment: { completed: boolean; graded: boolean; pass_count: number; refer_count: number };
  money_in_bonus: {
    applicable: boolean; invoice_no: string | null; issued: boolean; paid: boolean;
    total: number | null; paid_at: string | null; receipt_no: string | null; receipt_amount: number | null;
  };
  certificates: {
    booked_total: number; booked_issued: number; bonus_total: number; bonus_issued: number; all_issued: boolean;
  };
  money_out: {
    applicable: boolean; expected_examiner: number; expected_instructor: number; expected_hosting: number;
    raised: boolean; approved: boolean; paid: boolean;
    vouchers: { voucher_no: string | null; category: string; status: string; amount: number; payee_name: string | null }[];
  };
}

type PillState = 'done' | 'pending' | 'na';
interface Pill { label: string; state: PillState; sub?: string | null }

function money(n: number | null | undefined): string {
  return `RM ${Number(n ?? 0).toFixed(2)}`;
}
function pretty(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

const CSS = `
.mas-proc { display: flex; flex-direction: column; gap: 0.55rem; }
.mas-proc-banner {
  display: inline-flex; align-items: center; gap: 0.4rem; align-self: flex-start;
  padding: 0.3rem 0.7rem; border-radius: 999px; font-size: 0.82rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.mas-proc-banner.is-ok  { background: #dff3e6; color: #0d5928; }
.mas-proc-banner.is-not { background: #fdf0d5; color: #7a5b00; }
.mas-proc-phase { display: grid; grid-template-columns: 9.5rem 1fr; gap: 0.5rem; align-items: start; }
@media (max-width: 640px) { .mas-proc-phase { grid-template-columns: 1fr; gap: 0.25rem; } }
.mas-proc-phaselabel { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--mas-muted, #5b6472); padding-top: 0.2rem; }
.mas-proc-pills { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.mas-proc-pill {
  display: inline-flex; align-items: baseline; gap: 0.3rem; padding: 0.22rem 0.55rem;
  border-radius: 6px; font-size: 0.8rem; border: 1px solid transparent; white-space: nowrap;
}
.mas-proc-pill .dot { font-weight: 700; }
.mas-proc-pill .sub { color: var(--mas-muted, #5b6472); font-size: 0.74rem; }
.mas-proc-pill.is-done    { background: #e7f5ec; border-color: #b7e0c4; color: #0d5928; }
.mas-proc-pill.is-done .sub { color: #2f7a4c; }
.mas-proc-pill.is-pending { background: #fdf4e3; border-color: #f0dcae; color: #7a5b00; }
.mas-proc-pill.is-na      { background: #f1f3f7; border-color: #e3e9f3; color: #8a93a5; }
.mas-proc-vouchers { margin: 0.15rem 0 0; padding-left: 1rem; font-size: 0.78rem; color: var(--mas-muted, #5b6472); }
.mas-proc-vouchers li { margin: 0.1rem 0; }
`;

function P({ label, state, sub }: Pill) {
  const glyph = state === 'done' ? '✓' : state === 'na' ? '–' : '•';
  return (
    <span className={`mas-proc-pill is-${state}`}>
      <span className="dot" aria-hidden="true">{glyph}</span>
      <span>{label}</span>
      {sub ? <span className="sub">{sub}</span> : null}
    </span>
  );
}

function Phase({ label, pills }: { label: string; pills: Pill[] }) {
  return (
    <div className="mas-proc-phase">
      <div className="mas-proc-phaselabel">{label}</div>
      <div className="mas-proc-pills">
        {pills.map((p, i) => <P key={i} {...p} />)}
      </div>
    </div>
  );
}

function bool(state: boolean): PillState {
  return state ? 'done' : 'pending';
}

export default function SessionProcessOverview({ data }: { data: ProcessOverview }) {
  const mb = data.money_in_booked;
  const bn = data.money_in_bonus;
  const c = data.certificates;
  const mo = data.money_out;

  return (
    <div className="mas-proc">
      <style>{CSS}</style>

      <span className={`mas-proc-banner ${data.reconciled ? 'is-ok' : 'is-not'}`}>
        {data.reconciled ? '✓ Fully reconciled' : '● Not yet reconciled'}
      </span>

      <Phase label="Setup" pills={[
        { label: 'Created', state: bool(data.setup.created) },
        { label: 'Roster', state: bool(data.setup.roster), sub: `${data.setup.candidate_count} cand.` },
        { label: 'Examiner assigned', state: bool(data.setup.examiner) },
      ]} />

      <Phase label="Money in · booked" pills={mb.applicable ? [
        { label: 'Invoice issued', state: bool(mb.issued), sub: mb.invoice_no },
        { label: 'Paid', state: bool(mb.paid), sub: mb.total != null ? money(mb.total) : null },
        { label: 'Receipt', state: mb.receipt_no ? 'done' : 'pending', sub: mb.receipt_no },
      ] : [{ label: 'No booked invoice', state: 'na' }]} />

      <Phase label="Assessment" pills={[
        { label: 'Completed', state: bool(data.assessment.completed) },
        { label: 'Graded', state: bool(data.assessment.graded),
          sub: `${data.assessment.pass_count} pass · ${data.assessment.refer_count} refer` },
      ]} />

      {bn.applicable && (
        <Phase label="Money in · bonus" pills={[
          { label: 'Bonus invoice issued', state: bool(bn.issued), sub: bn.invoice_no },
          { label: 'Paid', state: bool(bn.paid), sub: bn.total != null ? money(bn.total) : null },
          { label: 'Receipt', state: bn.receipt_no ? 'done' : 'pending', sub: bn.receipt_no },
        ]} />
      )}

      <Phase label="Certificates" pills={[
        { label: 'Booked certs', state: c.booked_total > 0 && c.booked_total === c.booked_issued ? 'done' : (c.booked_total === 0 ? 'na' : 'pending'),
          sub: `${c.booked_issued}/${c.booked_total}` },
        ...(c.bonus_total > 0 ? [{ label: 'Bonus certs', state: (c.bonus_total === c.bonus_issued ? 'done' : 'pending') as PillState,
          sub: `${c.bonus_issued}/${c.bonus_total}` }] : []),
      ]} />

      {mo.applicable && (
        <>
          <Phase label="Money out · payouts" pills={[
            { label: 'Voucher raised', state: bool(mo.raised) },
            { label: 'Approved', state: mo.approved ? 'done' : 'pending' },
            { label: 'Paid', state: mo.paid ? 'done' : 'pending' },
            { label: 'Expected', state: 'na',
              sub: `E ${money(mo.expected_examiner)} · I ${money(mo.expected_instructor)} · H ${money(mo.expected_hosting)}` },
          ]} />
          {mo.vouchers.length > 0 && (
            <ul className="mas-proc-vouchers">
              {mo.vouchers.map((v, i) => (
                <li key={i}>
                  <strong>{v.voucher_no ?? '(draft)'}</strong> · {pretty(v.category)} · {v.payee_name ?? '—'} · {money(v.amount)} · {pretty(v.status)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
