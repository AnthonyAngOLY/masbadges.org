import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/admin.css';

interface StateRow { state: string; }
interface MyReg {
  id: string;
  centre_name: string;
  state: string;
  centre_status: string;
  application_status: string;
  poc_email: string;
  created_at: string;
}

const APP_STATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Submitted', cls: 'is-warning' },
  pending:   { label: 'In review', cls: 'is-info' },
  approved:  { label: 'Approved', cls: 'is-success' },
  denied:    { label: 'Denied', cls: 'is-danger' },
  archived:  { label: 'Archived', cls: '' },
};

export default function RegisterCentre() {
  const [states, setStates] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [state, setState] = useState('');
  const [pocName, setPocName] = useState('');
  const [pocEmail, setPocEmail] = useState('');
  const [pocPhone, setPocPhone] = useState('');
  const [address, setAddress] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const [mine, setMine] = useState<MyReg[]>([]);

  const fetchMine = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_my_centre_registrations');
    if (error) { console.error('list_my_centre_registrations failed:', error.message); return; }
    setMine((data ?? []) as MyReg[]);
  }, []);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('list_states');
      if (error) { console.error('list_states failed:', error.message); return; }
      setStates(((data ?? []) as StateRow[]).map((x) => x.state));
    })();
    fetchMine();
  }, [fetchMine]);

  const canSubmit = name.trim().length > 1 && !!state && pocEmail.includes('@') && !busy;

  function clearForm() {
    setName(''); setState(''); setPocName(''); setPocEmail(''); setPocPhone(''); setAddress('');
    setError(null); setOk(false);
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setError(null); setOk(false);
    const { error } = await supabase.rpc('register_centre', {
      _name: name,
      _state: state,
      _poc_email: pocEmail,
      _poc_name: pocName || null,
      _poc_phone: pocPhone || null,
      _address: address || null,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setOk(true);
    clearForm();
    fetchMine();
  }

  return (
    <section className="mas-page">
      <header className="mas-page-head mas-page-head-row">
        <div>
          <p className="mas-eyebrow">Partner centres</p>
          <h1>Register a centre</h1>
          <p className="mas-lede">
            As a MAS Badges–certified instructor, register the centre you’re
            appointed to. It’s submitted to the Chairperson for approval and
            stays pending until approved and billed.
          </p>
        </div>
        <div className="mas-page-actions">
          <button className="mas-btn-ghost" onClick={clearForm} disabled={busy}>Clear</button>
          <button className="mas-btn-primary" onClick={submit} disabled={!canSubmit}>
            {busy ? 'Submitting…' : 'Submit for approval'}
          </button>
        </div>
      </header>

      {ok && (
        <div className="mas-alert is-success">
          <div className="mas-alert-body">
            <p className="mas-alert-title">Centre submitted for approval</p>
            <p className="mas-alert-text">You’ll see it below as “In review”. The Chairperson will be in touch.</p>
          </div>
        </div>
      )}
      {error && (
        <div className="mas-alert is-danger">
          <div className="mas-alert-body"><p className="mas-alert-text">{error}</p></div>
        </div>
      )}

      <div className="mas-form">
        <div className="mas-form-cardhead">
          <div>
            <p className="mas-eyebrow">Centre details</p>
            <h2>New centre</h2>
          </div>
          <span className="mas-badge is-primary">You are the appointed instructor</span>
        </div>

        <div className="mas-form-grid">
          <div className="mas-field">
            <label htmlFor="name" className="mas-field-label">Centre name <span className="mas-req">*</span></label>
            <input id="name" className="mas-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Splash Aquatics Centre" />
          </div>
          <div className="mas-field">
            <label htmlFor="state" className="mas-field-label">State <span className="mas-req">*</span></label>
            <select id="state" className="mas-select" value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">Select a state…</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="mas-field">
            <label htmlFor="poce" className="mas-field-label">Point-of-communication email <span className="mas-req">*</span></label>
            <input id="poce" type="email" className="mas-input" value={pocEmail} onChange={(e) => setPocEmail(e.target.value)} placeholder="owner@centre.com" />
            <p className="mas-field-note">After approval, this is the email invited to administer the centre.</p>
          </div>
          <div className="mas-field">
            <label htmlFor="pocn" className="mas-field-label">Point-of-communication name <span className="mas-field-opt">(optional)</span></label>
            <input id="pocn" className="mas-input" value={pocName} onChange={(e) => setPocName(e.target.value)} placeholder="Owner / manager" />
          </div>

          <div className="mas-field">
            <label htmlFor="pocp" className="mas-field-label">Contact phone <span className="mas-field-opt">(optional)</span></label>
            <input id="pocp" type="tel" className="mas-input" value={pocPhone} onChange={(e) => setPocPhone(e.target.value)} placeholder="e.g. 03-1234 5678" />
          </div>
          <div className="mas-field">
            <label htmlFor="addr" className="mas-field-label">Address <span className="mas-field-opt">(optional)</span></label>
            <input id="addr" className="mas-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, postcode" />
          </div>
        </div>
      </div>

      <header className="mas-page-head mas-section-head"><h2>Your registrations</h2></header>
      {mine.length === 0 && <p className="mas-status">You haven’t registered a centre yet.</p>}
      {mine.length > 0 && (
        <ul className="mas-admin-list">
          {mine.map((c) => (
            <li key={c.id} className="mas-admin-row">
              <div className="mas-admin-main">
                <h3 className="mas-admin-name">{c.centre_name}</h3>
                <p className="mas-admin-meta">
                  <span className="mas-pill">{c.state}</span>
                  <span className={`mas-badge ${APP_STATUS[c.application_status]?.cls ?? ''}`}>
                    {APP_STATUS[c.application_status]?.label ?? c.application_status}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
