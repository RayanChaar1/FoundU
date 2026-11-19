import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import Field from '../../components/Field';
import { ConfirmButton, Notice, run } from '../admin/shared';

/* The Organization tab of the Admin page: email domains (FR-18.5), karma points and QR tags (FR-18.6, FR-18.7),
   and the organization's identity provider (FR-18.8).  Campuses, buildings, drop-off points and categories have
   their own tabs. */
export default function Organization() {
  return (
    <>
      <Domains />
      <Features />
      <SingleSignOn />
    </>
  );
}

function Domains() {
  const [data, setData] = useState(null);
  const [domain, setDomain] = useState('');
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);

  useEffect(() => { api.get('/org/domains').then(setData).catch((e) => setNotice({ kind: 'error', text: e.message })); }, []);

  const add = async (e) => {
    e.preventDefault();
    const errs = await run(setNotice, async () => {
      setData(await api.post('/org/domains', { domain }));
    }, `${domain.trim().toLowerCase()} added.  Its members can now sign in.`);
    setErrors(errs);
    if (!errs._) setDomain('');
  };
  const remove = (d) => run(setNotice, async () => setData(await api.del(`/org/domains/${encodeURIComponent(d)}`)), `${d} removed.`);

  return (
    <section className="card panel admin-section">
      <h2>Email domains</h2>
      <p className="hint">Members sign in with an address at one of these domains.</p>
      <Notice notice={notice} />
      {data && (
        <>
          <div className="table-scroll"><table className="admin-table">
            <thead><tr><th>Domain</th><th>Members</th><th /></tr></thead>
            <tbody>
              {data.domains.map((d) => (
                <tr key={d.domain}>
                  <td>{d.domain}</td>
                  <td>{d.users}</td>
                  <td className="row-actions">
                    <ConfirmButton label="Remove" confirm="Confirm remove" disabled={data.domains.length === 1} onConfirm={() => remove(d.domain)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="hint" style={{ marginTop: '1rem' }}>To add a domain, first add this TXT record to its DNS, so FoundU knows it is yours:</p>
          <code className="dns-record">{data.dnsRecord}</code>
          <form className="inline-form add-form" onSubmit={add} noValidate>
            <Field id="new-domain" label="New domain" error={errors.domain}>
              <input id="new-domain" value={domain} placeholder="alumni.lau.edu" onChange={(e) => setDomain(e.target.value)} />
            </Field>
            <button className="btn" disabled={!domain.trim()}>Verify and add</button>
          </form>
        </>
      )}
    </section>
  );
}

const SWITCHES = [
  ['karmaEnabled', 'Karma points', 'Members earn points and badges for returning items, and the semester leaderboard is shown (FR-13).  When off, no points are awarded and the Karma page is hidden.'],
  ['qrEnabled', 'QR tags', 'Members can print QR tags for their belongings, so a finder can contact them by scanning (FR-12).  When off, existing tags stop working until it is turned back on.'],
];

function Features() {
  const { refresh } = useAuth();
  const [settings, setSettings] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => { api.get('/org/settings').then(setSettings).catch((e) => setNotice({ kind: 'error', text: e.message })); }, []);

  const toggle = (key, label, value) => run(setNotice, async () => {
    setSettings(await api.patch('/org/settings', { [key]: value }));
    await refresh(); // the navigation shows or hides the feature at once
  }, `${label} ${value ? 'enabled' : 'disabled'} for your organization.`);

  return (
    <section className="card panel admin-section">
      <h2>Features</h2>
      <Notice notice={notice} />
      {settings && SWITCHES.map(([key, label, text]) => (
        <div className="switch-row" key={key}>
          <div>
            <strong>{label}</strong>
            <p className="hint">{text}</p>
          </div>
          <label className="check">
            <input type="checkbox" aria-label={label} checked={settings[key]} onChange={(e) => toggle(key, label, e.target.checked)} />
            {settings[key] ? 'On' : 'Off'}
          </label>
        </div>
      ))}
    </section>
  );
}

function SingleSignOn() {
  const [sso, setSso] = useState(null);
  const [form, setForm] = useState({ issuer: '', clientId: '', clientSecret: '' });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const show = (s) => {
    setSso(s);
    setForm({ issuer: s.issuer || '', clientId: s.clientId || '', clientSecret: '' });
  };
  useEffect(() => { api.get('/org/sso').then(show).catch((e) => setNotice({ kind: 'error', text: e.message })); }, []);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const connect = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors(await run(setNotice, async () => show(await api.put('/org/sso', form)),
      'The test sign-in succeeded.  Single sign-on is connected.'));
    setBusy(false);
  };
  const disconnect = () => run(setNotice, async () => show(await api.del('/org/sso')), 'Single sign-on disconnected.');

  if (!sso) return <Notice notice={notice} />;
  return (
    <form className="card panel admin-section" onSubmit={connect} noValidate>
      <div className="section-head">
        <h2>Single sign-on</h2>
        <span className={`badge ${sso.enabled ? 'status' : 'sensitive'}`}>{sso.enabled ? 'Connected' : 'Not connected'}</span>
      </div>
      <p className="hint">Connect your own OpenID Connect identity provider (for example Microsoft Entra ID or Google Workspace).
        FoundU tests the settings with a sign-in to your provider and keeps them only if the test succeeds.
        Register this redirect address at your provider: <code style={{ overflowWrap: 'anywhere' }}>{sso.redirectUri}</code></p>
      <Notice notice={notice} />
      <Field id="sso-issuer" label="Issuer URL" error={errors.issuer}>
        <input id="sso-issuer" value={form.issuer} placeholder="https://login.microsoftonline.com/<tenant>/v2.0" onChange={set('issuer')} />
      </Field>
      <div className="row">
        <Field id="sso-client" label="Client ID" error={errors.clientId}>
          <input id="sso-client" value={form.clientId} onChange={set('clientId')} autoComplete="off" />
        </Field>
        <Field id="sso-secret" label="Client secret" hint={sso.hasSecret ? '(leave blank to keep the saved one)' : ''} error={errors.clientSecret}>
          <input id="sso-secret" type="password" value={form.clientSecret} onChange={set('clientSecret')} autoComplete="new-password" />
        </Field>
      </div>
      <div className="actions">
        <button className="btn" disabled={busy}>{busy ? 'Testing…' : 'Test and connect'}</button>
        {sso.enabled && <ConfirmButton label="Disconnect" confirm="Confirm disconnect" onConfirm={disconnect} />}
      </div>
    </form>
  );
}
