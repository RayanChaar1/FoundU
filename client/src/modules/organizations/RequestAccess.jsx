import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import Field from '../../components/Field';

const emptyCampus = { name: '', latitude: '', longitude: '' };

/* FR-18.1: an organization asks to join FoundU.  No account is needed; the answer shows the DNS record that proves
   the organization controls its domains (FR-18.2). */
export default function RequestAccess() {
  const [form, setForm] = useState({ name: '', type: 'UNIVERSITY', contactName: '', contactEmail: '' });
  const [domains, setDomains] = useState(['']);
  const [campuses, setCampuses] = useState([{ ...emptyCampus }]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const setAt = (list, setList, i, value) => setList(list.map((x, j) => (j === i ? value : x)));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      setDone(await api.post('/organizations/requests', {
        ...form,
        domains: domains.map((d) => d.trim()).filter(Boolean),
        campuses: campuses.map((c) => ({ ...c, latitude: c.latitude === '' ? undefined : c.latitude, longitude: c.longitude === '' ? undefined : c.longitude })),
      }));
    } catch (err) {
      setError(err.message);
      setErrors(err.fields);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="join-page">
        <div className="card">
          <div className="brand"><img src="/icon.png" alt="" width={28} height={28} /> FoundU</div>
          <h1>Request sent</h1>
          <div className="alert success" role="status">We received the request of {done.name}.  It is pending review.</div>
          <p>To prove that {done.name} controls its email domains, ask your IT team to add this TXT record to the DNS of
            {' '}{domains.filter(Boolean).join(' and ')}:</p>
          <code className="dns-record">{done.dnsRecord}</code>
          <p className="hint">We also sent it to {form.contactEmail}.  A FoundU administrator checks the record and activates
            your organization; you will receive an email when it is done.</p>
          <p><Link to="/signin">Back to sign in</Link></p>
        </div>
      </div>
    );
  }

  return (
    <div className="join-page">
      <form className="card" onSubmit={submit} noValidate>
        <div className="brand"><img src="/icon.png" alt="" width={28} height={28} /> FoundU</div>
        <h1>Request access for your organization</h1>
        <p className="hint">For universities and companies.  Your members then sign in with their organization email.</p>
        {error && <div className="alert error" role="alert">{error}</div>}

        <div className="row">
          <Field id="org-name" label="Name of the organization" error={errors.name}>
            <input id="org-name" value={form.name} onChange={set('name')} placeholder="Cedar Bank" autoFocus />
          </Field>
          <Field id="org-type" label="Type" error={errors.type}>
            <select id="org-type" value={form.type} onChange={set('type')}>
              <option value="UNIVERSITY">University</option>
              <option value="COMPANY">Company</option>
            </select>
          </Field>
        </div>

        <h3 className="section-title">Email domains</h3>
        <p className="hint">The part after @ in your members' addresses.  Public providers such as gmail.com are not accepted.</p>
        {errors.domains && <div className="field-error" role="alert">{errors.domains}</div>}
        <div className="list-rows">
          {domains.map((d, i) => (
            <div className="list-row" key={i}>
              <Field id={`domain-${i}`} label={`Domain ${i + 1}`} error={errors[`domains.${i}`]}>
                <input id={`domain-${i}`} value={d} placeholder="cedarbank.com" onChange={(e) => setAt(domains, setDomains, i, e.target.value)} />
              </Field>
              <button type="button" className="btn secondary small" disabled={domains.length === 1}
                onClick={() => setDomains(domains.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
        </div>
        <button type="button" className="btn secondary small" disabled={domains.length >= 10} onClick={() => setDomains([...domains, ''])}>Add a domain</button>

        <h3 className="section-title">Campuses</h3>
        <p className="hint">For each site, its position on the map (in Google Maps, right-click the place to copy it).</p>
        {errors.campuses && <div className="field-error" role="alert">{errors.campuses}</div>}
        <div className="list-rows">
          {campuses.map((c, i) => (
            <div className="campus-row" key={i}>
              <Field id={`campus-${i}`} label="Campus" error={errors[`campuses.${i}.name`]}>
                <input id={`campus-${i}`} value={c.name} placeholder="Head Office" onChange={(e) => setAt(campuses, setCampuses, i, { ...c, name: e.target.value })} />
              </Field>
              <Field id={`lat-${i}`} label="Latitude" error={errors[`campuses.${i}.latitude`]}>
                <input id={`lat-${i}`} inputMode="decimal" value={c.latitude} placeholder="33.8959" onChange={(e) => setAt(campuses, setCampuses, i, { ...c, latitude: e.target.value })} />
              </Field>
              <Field id={`lng-${i}`} label="Longitude" error={errors[`campuses.${i}.longitude`]}>
                <input id={`lng-${i}`} inputMode="decimal" value={c.longitude} placeholder="35.4889" onChange={(e) => setAt(campuses, setCampuses, i, { ...c, longitude: e.target.value })} />
              </Field>
              <button type="button" className="btn secondary small" disabled={campuses.length === 1}
                onClick={() => setCampuses(campuses.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
        </div>
        <button type="button" className="btn secondary small" disabled={campuses.length >= 20} onClick={() => setCampuses([...campuses, { ...emptyCampus }])}>Add a campus</button>

        <h3 className="section-title">Contact administrator</h3>
        <p className="hint">This person becomes the first administrator of your organization on FoundU.</p>
        <div className="row">
          <Field id="contact-name" label="Full name" error={errors.contactName}>
            <input id="contact-name" autoComplete="name" value={form.contactName} onChange={set('contactName')} />
          </Field>
          <Field id="contact-email" label="Email at one of the domains" error={errors.contactEmail}>
            <input id="contact-email" type="email" autoComplete="email" value={form.contactEmail} onChange={set('contactEmail')} />
          </Field>
        </div>

        <div className="actions" style={{ marginTop: '1rem' }}>
          <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send the request'}</button>
          <Link className="btn secondary" to="/signin">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
