import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/admin.css';

// Examiner grading — dense table with expandable per-candidate grading rows.
// Reads via list_my_grading_roster(); writes via mark_attendance /
// record_assessment_outcome / submit_session_results.
// FIREWALL: no fee/invoice/payment value anywhere on this screen.
// LOCK: once a session is submitted (completed/closed/archived/cancelled) it renders
// view-only — the server refuses writes; the UI hides the controls.
// WEATHER: "Declare rain-off" calls weather_hold_session() to put a claimed session
// on hold IN PLACE (same paid invoice carries over — no fee change). A rained-off
// session (status weather_hold) is view-only here until the instructor sets a new date.

const LEVELS: { value: string; label: string }[] = [
  { value: 'starfish', label: 'Starfish' },
  { value: 'sea_turtle', label: 'Sea Turtle' },
  { value: 'guppy', label: 'Guppy' },
  { value: 'octopus', label: 'Octopus' },
  { value: 'frog', label: 'Frog' },
  { value: 'swordfish', label: 'Swordfish' },
  { value: 'dolphin', label: 'Dolphin' },
];

const ATTENDANCE: { value: Attendance; label: string }[] = [
  { value: 'registered', label: 'Registered' },
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'no_show', label: 'No show' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

const LOCKED_STATUSES = ['completed', 'closed', 'archived', 'cancelled'];

type Attendance = 'registered' | 'present' | 'absent' | 'no_show' | 'withdrawn';
type Outcome = 'pass' | 'refer';
type Load = 'loading' | 'ready' | 'error';

interface LevelResult {
  level: string;
  outcome: Outcome | null;
  stage: string | null;
}
interface RosterRow {
  session_id: string;
  venue: string | null;
  scheduled_on: string | null;
  session_status: string;
  enrolment_id: string;
  candidate_name: string;
  booked_level: string;
  attendance: Attendance;
  levels: LevelResult[];
}

function levelLabel(value: string): string {
  return LEVELS.find((l) => l.value === value)?.label ?? value;
}
function levelIndex(value: string): number {
  return LEVELS.findIndex((l) => l.value === value);
}
function formatDate(d: string | null): string {
  if (!d) return '';
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function attendanceLabel(a: Attendance): string {
  return ATTENDANCE.find((x) => x.value === a)?.label ?? a;
}

// Levels the examiner can act on: every passed level (correctable) plus the first
// not-yet-passed level. Stops at a refer or ungraded level. Mirrors the server no-skip rule.
function gradeableChain(row: RosterRow): string[] {
  const recorded = new Map(row.levels.map((l) => [l.level, l.outcome]));
  const chain: string[] = [];
  let i = Math.max(0, levelIndex(row.booked_level));
  while (i < LEVELS.length) {
    const value = LEVELS[i].value;
    chain.push(value);
    if (recorded.get(value) === 'pass') {
      i += 1;
      continue;
    }
    break;
  }
  return chain;
}

const TABLE_CSS = `
.mas-gwrap { overflow-x: auto; border: 1px solid var(--border, #e3e7ee); border-radius: 12px; }
.mas-gtable { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.mas-gtable thead th {
  text-align: left; padding: 0.55rem 0.7rem; background: #1E2752; color: #fff;
  font-size: 0.74rem; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap;
}
.mas-gtable tbody td { padding: 0.45rem 0.7rem; border-top: 1px solid var(--border, #e3e7ee); vertical-align: middle; }
.mas-grow:hover { background: #f6f8fc; }
.mas-grow.is-open { background: #eef2f8; }
.mas-gname { font-weight: 600; color: var(--navy, #1E2752); }
.mas-gpill { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; background: #1E2752; color: #fff; font-size: 0.72rem; }
.mas-gsel { font: inherit; padding: 0.3rem 0.45rem; border: 1px solid var(--border, #e3e7ee); border-radius: 6px; background: #fff; max-width: 9rem; }
.mas-gout { font-size: 0.74rem; font-weight: 600; margin-right: 0.5rem; white-space: nowrap; }
.mas-gout.is-pass { color: var(--ok, #1a7f4b); }
.mas-gout.is-refer { color: var(--warn, #b4690e); }
.mas-gexpand { cursor: pointer; border: 1px solid var(--border, #e3e7ee); background: #fff; color: #1E2752; border-radius: 6px; padding: 0.3rem 0.6rem; font: inherit; font-weight: 600; white-space: nowrap; }
.mas-gdetail td { background: #f9fafc; padding: 0.6rem 0.9rem 0.9rem; }
.mas-glevel { display: flex; align-items: center; gap: 0.6rem; padding: 0.35rem 0; flex-wrap: wrap; }
.mas-glevel-name { min-width: 11rem; font-size: 0.88rem; }
.mas-gactions { display: flex; gap: 0.4rem; }
.mas-gnote { margin-top: 0.5rem; }
.mas-gnote input { font: inherit; width: 100%; max-width: 26rem; padding: 0.4rem 0.55rem; border: 1px solid var(--border, #e3e7ee); border-radius: 6px; }
.mas-rainoff-panel { border: 1px solid var(--border, #e3e7ee); border-radius: 10px; padding: 0.75rem; max-width: 34rem; background: #fff; }
.mas-rainoff-panel textarea { font: inherit; width: 100%; padding: 0.45rem 0.55rem; border: 1px solid var(--border, #e3e7ee); border-radius: 6px; box-sizing: border-box; resize: vertical; }
.mas-rainoff-check { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.5rem; font-size: 0.85rem; }
@media (max-width: 640px) { .mas-glevel-name { min-width: 7rem; } .mas-gsel { max-width: 7rem; } }
`;

export default function ExaminerGrading() {
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [sessionError, setSessionError] = useState<Record<string, string>>({});

  // Rain-off panel state (per session).
  const [rainOpen, setRainOpen] = useState<Record<string, boolean>>({});
  const [rainReason, setRainReason] = useState<Record<string, string>>({});
  const [rainCarry, setRainCarry] = useState<Record<string, boolean>>({});

  // Examiner remarks — per session, saved via set_session_examiner_remarks.
  // Loaded lazily on first render of a session (see fetchRemarks).
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [remarksLoaded, setRemarksLoaded] = useState<Record<string, boolean>>({});
  const [remarksSaving, setRemarksSaving] = useState<string | null>(null);
  const [remarksMsg, setRemarksMsg] = useState<Record<string, { ok: boolean; text: string }>>({});

  const fetchRoster = useCallback(async () => {
    setLoad('loading');
    const { data, error } = await supabase.rpc('list_my_grading_roster');
    if (error) {
      setLoad('error');
      return;
    }
    setRows((data ?? []) as RosterRow[]);
    setLoad('ready');
  }, []);

  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  // Fetch existing examiner remarks for each session once its group appears.
  // Cheap and avoids adding examiner_remarks to the roster RPC return shape.
  useEffect(() => {
    if (load !== 'ready') return;
    for (const r of rows) {
      if (!remarksLoaded[r.session_id]) {
        fetchRemarks(r.session_id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, load]);

  const groups = useMemo(() => {
    const map = new Map<string, { row: RosterRow; enrolments: RosterRow[] }>();
    for (const r of rows) {
      if (!map.has(r.session_id)) map.set(r.session_id, { row: r, enrolments: [] });
      map.get(r.session_id)!.enrolments.push(r);
    }
    return Array.from(map.values());
  }, [rows]);

  function toggle(id: string) {
    setExpanded((m) => ({ ...m, [id]: !m[id] }));
  }
  function clearRowError(id: string) {
    setRowError((m) => {
      const n = { ...m };
      delete n[id];
      return n;
    });
  }

  async function setAttendance(row: RosterRow, attendance: Attendance) {
    const key = `att:${row.enrolment_id}`;
    setBusyKey(key);
    clearRowError(row.enrolment_id);
    const { error } = await supabase.rpc('mark_attendance', {
      _enrolment_id: row.enrolment_id,
      _attendance: attendance,
    });
    setBusyKey(null);
    if (error) {
      setRowError((m) => ({ ...m, [row.enrolment_id]: error.message }));
      return;
    }
    setRows((list) =>
      list.map((x) => (x.enrolment_id === row.enrolment_id ? { ...x, attendance } : x)),
    );
  }

  async function grade(row: RosterRow, level: string, outcome: Outcome) {
    const key = `grade:${row.enrolment_id}:${level}`;
    setBusyKey(key);
    clearRowError(row.enrolment_id);
    const note = notes[row.enrolment_id]?.trim();
    const { error } = await supabase.rpc('record_assessment_outcome', {
      _enrolment_id: row.enrolment_id,
      _level: level,
      _outcome: outcome,
      _notes: note || null,
    });
    setBusyKey(null);
    if (error) {
      setRowError((m) => ({ ...m, [row.enrolment_id]: error.message }));
      return;
    }
    await fetchRoster();
  }

  async function submitSession(sessionId: string) {
    if (!window.confirm('Submit results for this session? This marks it completed and locks grading.')) return;
    const key = `submit:${sessionId}`;
    setBusyKey(key);
    setSessionError((m) => {
      const n = { ...m };
      delete n[sessionId];
      return n;
    });
    const { error } = await supabase.rpc('submit_session_results', { _session_id: sessionId });
    setBusyKey(null);
    if (error) {
      setSessionError((m) => ({ ...m, [sessionId]: error.message }));
      return;
    }
    await fetchRoster();
  }

  async function declareRainOff(sessionId: string) {
    const reason = (rainReason[sessionId] ?? '').trim();
    if (!reason) {
      setSessionError((m) => ({ ...m, [sessionId]: 'Add a short reason for the rain-off.' }));
      return;
    }
    const key = `weather:${sessionId}`;
    setBusyKey(key);
    setSessionError((m) => {
      const n = { ...m };
      delete n[sessionId];
      return n;
    });
    const { error } = await supabase.rpc('weather_hold_session', {
      _session_id: sessionId,
      _reason: reason,
      _examiner_can_carry: rainCarry[sessionId] ?? true,
    });
    setBusyKey(null);
    if (error) {
      setSessionError((m) => ({ ...m, [sessionId]: error.message }));
      return;
    }
    setRainOpen((m) => ({ ...m, [sessionId]: false }));
    await fetchRoster();
  }

  async function fetchRemarks(sessionId: string) {
    if (remarksLoaded[sessionId]) return;
    // Read the current examiner_remarks value directly from the session row.
    // Any real role on the session may read; the setter RPC enforces write auth.
    const { data, error } = await supabase
      .from('assessment_sessions')
      .select('examiner_remarks')
      .eq('id', sessionId)
      .single();
    if (error) {
      // Falling through would put '' in the box and mark it loaded, so saving
      // would overwrite the examiner's existing remarks with nothing. Leave it
      // unloaded so the next open retries.
      console.error('examiner_remarks load failed:', error.message);
      return;
    }
    setRemarks((m) => ({ ...m, [sessionId]: (data as { examiner_remarks: string | null } | null)?.examiner_remarks ?? '' }));
    setRemarksLoaded((m) => ({ ...m, [sessionId]: true }));
  }

  async function saveRemarks(sessionId: string) {
    setRemarksSaving(sessionId);
    setRemarksMsg((m) => { const n = { ...m }; delete n[sessionId]; return n; });
    const trimmed = (remarks[sessionId] ?? '').trim();
    const { error } = await supabase.rpc('set_session_examiner_remarks', {
      _session_id: sessionId,
      _remarks: trimmed || null,
    });
    setRemarksSaving(null);
    if (error) {
      setRemarksMsg((m) => ({ ...m, [sessionId]: { ok: false, text: error.message } }));
      return;
    }
    setRemarksMsg((m) => ({ ...m, [sessionId]: { ok: true, text: 'Remarks saved.' } }));
  }

  return (
    <section className="mas-page">
      <style>{TABLE_CSS}</style>
      <header className="mas-page-head">
        <p className="mas-eyebrow">Examiner</p>
        <h1>Grading</h1>
        <p className="mas-lede">
          Mark attendance and grade each candidate. Open a row to grade the booked level;
          a pass reveals the next level on the pathway. Submit a session when done — once
          submitted, it locks to view-only. If weather stops play, declare a rain-off and the
          instructor re-books the same session at no extra charge.
        </p>
      </header>

      <div className="mas-admin-toolbar">
        <button className="mas-btn-ghost" onClick={fetchRoster} disabled={load === 'loading'}>
          Refresh
        </button>
      </div>

      {load === 'loading' && <p className="mas-status">Loading roster…</p>}
      {load === 'error' && (
        <p className="mas-status mas-status-bad">Couldn’t load your roster. Refresh to try again.</p>
      )}
      {load === 'ready' && groups.length === 0 && (
        <p className="mas-status">You have no sessions assigned to assess.</p>
      )}

      {load === 'ready' &&
        groups.map(({ row: head, enrolments }) => {
          const locked = LOCKED_STATUSES.includes(head.session_status);
          const onHold = head.session_status === 'weather_hold';
          const readOnly = locked || onHold;
          return (
            <div key={head.session_id} className="mas-grade-session">
              <div className="mas-grade-session-head">
                <h2 className="mas-admin-name">{head.venue || 'Assessment session'}</h2>
                <p className="mas-admin-sub">
                  {formatDate(head.scheduled_on) || 'Date TBC'}
                  {head.session_status ? ` · ${head.session_status.replace(/_/g, ' ')}` : ''}
                  {` · ${enrolments.length} candidate${enrolments.length === 1 ? '' : 's'}`}
                </p>
              </div>

              {locked && (
                <p className="mas-status mas-status-good">
                  Results submitted — this session is view-only. Track payment and certificate
                  release from your dashboard.
                </p>
              )}
              {onHold && (
                <p className="mas-status mas-status-good">
                  Rained off — awaiting a new date from the instructor. No fee change; the
                  original booking carries over. It returns here once rescheduled.
                </p>
              )}

              <div className="mas-gwrap">
                <table className="mas-gtable">
                  <thead>
                    <tr>
                      <th>Candidate</th>
                      <th>Booked</th>
                      <th>Attendance</th>
                      <th>Outcomes</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrolments.map((r) => {
                      const isOpen = !!expanded[r.enrolment_id];
                      const chain = gradeableChain(r);
                      const recorded = new Map(r.levels.map((l) => [l.level, l.outcome]));
                      const shownLevels = readOnly ? r.levels.map((l) => l.level) : chain;
                      return (
                        <Fragment key={r.enrolment_id}>
                          <tr className={`mas-grow${isOpen ? ' is-open' : ''}`}>
                            <td className="mas-gname">{r.candidate_name}</td>
                            <td><span className="mas-gpill">{levelLabel(r.booked_level)}</span></td>
                            <td>
                              {readOnly ? (
                                attendanceLabel(r.attendance)
                              ) : (
                                <select
                                  className="mas-gsel"
                                  value={r.attendance}
                                  disabled={busyKey === `att:${r.enrolment_id}`}
                                  onChange={(e) => setAttendance(r, e.target.value as Attendance)}
                                  aria-label={`Attendance for ${r.candidate_name}`}
                                >
                                  {ATTENDANCE.map((a) => (
                                    <option key={a.value} value={a.value}>{a.label}</option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td>
                              {r.levels.length === 0 ? (
                                <span className="mas-admin-sub">—</span>
                              ) : (
                                r.levels.map((l) => (
                                  <span
                                    key={l.level}
                                    className={`mas-gout ${l.outcome === 'pass' ? 'is-pass' : 'is-refer'}`}
                                  >
                                    {levelLabel(l.level)} {l.outcome === 'pass' ? '✓' : '✗'}
                                  </span>
                                ))
                              )}
                            </td>
                            <td>
                              <button className="mas-gexpand" onClick={() => toggle(r.enrolment_id)}>
                                {isOpen ? 'Close' : readOnly ? 'View' : 'Grade'}
                              </button>
                            </td>
                          </tr>

                          {isOpen && (
                            <tr className="mas-gdetail">
                              <td colSpan={5}>
                                {shownLevels.length === 0 && (
                                  <p className="mas-admin-sub">No outcomes recorded.</p>
                                )}
                                {shownLevels.map((level) => {
                                  const outcome = recorded.get(level) ?? null;
                                  const gradeKey = `grade:${r.enrolment_id}:${level}`;
                                  return (
                                    <div key={level} className="mas-glevel">
                                      <span className="mas-glevel-name">
                                        {levelLabel(level)}
                                        {level === r.booked_level ? ' · booked' : ' · bonus'}
                                      </span>
                                      {outcome && (
                                        <span className={`mas-gout ${outcome === 'pass' ? 'is-pass' : 'is-refer'}`}>
                                          {outcome === 'pass' ? 'Passed' : 'Referred'}
                                        </span>
                                      )}
                                      {!readOnly && (
                                        <div className="mas-gactions">
                                          <button
                                            className="mas-btn-primary"
                                            onClick={() => grade(r, level, 'pass')}
                                            disabled={busyKey === gradeKey}
                                            aria-pressed={outcome === 'pass'}
                                          >
                                            {busyKey === gradeKey ? '…' : 'Pass'}
                                          </button>
                                          <button
                                            className="mas-btn-ghost"
                                            onClick={() => grade(r, level, 'refer')}
                                            disabled={busyKey === gradeKey}
                                            aria-pressed={outcome === 'refer'}
                                          >
                                            Refer
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}

                                {!readOnly && (
                                  <div className="mas-gnote">
                                    <input
                                      type="text"
                                      value={notes[r.enrolment_id] ?? ''}
                                      onChange={(e) =>
                                        setNotes((m) => ({ ...m, [r.enrolment_id]: e.target.value }))
                                      }
                                      placeholder="Notes (optional) — recorded with the next outcome you save"
                                    />
                                  </div>
                                )}
                                {rowError[r.enrolment_id] && (
                                  <p className="mas-status mas-status-bad" style={{ marginTop: '0.5rem' }}>
                                    Couldn’t save: {rowError[r.enrolment_id]}
                                  </p>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!readOnly && (
                <div className="mas-grade-rainoff" style={{ marginTop: '0.75rem' }}>
                  {!rainOpen[head.session_id] ? (
                    <button
                      className="mas-btn-ghost"
                      onClick={() => setRainOpen((m) => ({ ...m, [head.session_id]: true }))}
                    >
                      Declare rain-off
                    </button>
                  ) : (
                    <div className="mas-rainoff-panel">
                      <p className="mas-admin-sub" style={{ marginTop: 0 }}>
                        A rain-off is not marked. The attendance you’ve set stays — except
                        candidates marked <strong>Present</strong> reset to pending for the new
                        date. The instructor sets the new date at no extra charge.
                      </p>
                      <textarea
                        value={rainReason[head.session_id] ?? ''}
                        onChange={(e) =>
                          setRainReason((m) => ({ ...m, [head.session_id]: e.target.value.slice(0, 200) }))
                        }
                        placeholder="Reason (e.g. lightning stand-down, pool closed) — required, max 200 characters"
                        rows={2}
                      />
                      <label className="mas-rainoff-check">
                        <input
                          type="checkbox"
                          checked={rainCarry[head.session_id] ?? true}
                          onChange={(e) =>
                            setRainCarry((m) => ({ ...m, [head.session_id]: e.target.checked }))
                          }
                        />
                        I can take the rescheduled session (untick to release it back to the pool)
                      </label>
                      <div className="mas-gactions" style={{ marginTop: '0.6rem' }}>
                        <button
                          className="mas-btn-primary"
                          onClick={() => declareRainOff(head.session_id)}
                          disabled={busyKey === `weather:${head.session_id}`}
                        >
                          {busyKey === `weather:${head.session_id}` ? 'Recording…' : 'Confirm rain-off'}
                        </button>
                        <button
                          className="mas-btn-ghost"
                          onClick={() => setRainOpen((m) => ({ ...m, [head.session_id]: false }))}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Examiner remarks — visible to governance and booking instructor; never to parents. */}
              <div className="mas-grade-remarks" style={{ marginTop: '0.75rem', maxWidth: '38rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--mas-muted, #5b6472)', marginBottom: '0.3rem' }}>
                  Examiner remarks <span style={{ fontSize: '0.72rem' }}>(optional, up to 200 chars) — visible to governance and the booking instructor; not shown to parents</span>
                </label>
                <textarea
                  value={remarks[head.session_id] ?? ''}
                  onChange={(e) => setRemarks((m) => ({ ...m, [head.session_id]: e.target.value.slice(0, 200) }))}
                  placeholder="Notes for governance and the booking instructor — venue observations, calibration notes, or context relevant to results."
                  rows={2}
                  disabled={readOnly}
                  style={{ width: '100%', font: 'inherit', padding: '0.4rem 0.55rem', border: '1px solid var(--border, #e3e7ee)', borderRadius: 6, boxSizing: 'border-box', resize: 'vertical' }}
                />
                {!readOnly && (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.3rem' }}>
                    <button
                      className="mas-btn-ghost mas-btn-compact"
                      onClick={() => saveRemarks(head.session_id)}
                      disabled={remarksSaving === head.session_id || !remarksLoaded[head.session_id]}
                    >
                      {remarksSaving === head.session_id ? 'Saving…' : 'Save remarks'}
                    </button>
                    <span style={{ fontSize: '0.75rem', color: 'var(--mas-muted, #5b6472)' }}>
                      {(remarks[head.session_id] ?? '').length}/200
                    </span>
                    {remarksMsg[head.session_id] && (
                      <span style={{ fontSize: '0.78rem', color: remarksMsg[head.session_id].ok ? 'var(--ok, #1a7f4b)' : 'var(--warn, #b4690e)' }}>
                        {remarksMsg[head.session_id].text}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {!readOnly && (
                <div className="mas-form-actions mas-grade-submit" style={{ marginTop: '0.75rem' }}>
                  <button
                    className="mas-btn-primary"
                    onClick={() => submitSession(head.session_id)}
                    disabled={busyKey === `submit:${head.session_id}`}
                  >
                    {busyKey === `submit:${head.session_id}` ? 'Submitting…' : 'Submit results'}
                  </button>
                </div>
              )}
              {sessionError[head.session_id] && (
                <p className="mas-status mas-status-bad">Couldn’t submit: {sessionError[head.session_id]}</p>
              )}
            </div>
          );
        })}
    </section>
  );
}
