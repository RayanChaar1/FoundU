import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { useAuth } from '../../auth';
import Field from '../../components/Field';

const STAFF = ['SECURITY', 'ORG_ADMIN', 'PLATFORM_ADMIN'];
const ADMIN = ['ORG_ADMIN', 'PLATFORM_ADMIN'];
const EMPTY = { name: '', campusId: '', locationId: '', opensAt: '08:00', closesAt: '17:00', contactNumber: '' };

/* FR-14.1, FR-14.2: the official drop-off points; administrators add new ones. */
export default function DropoffList() {
  const { user, reference } = useAuth();
  const [points, setPoints] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState(EMPTY);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/dropoffs').then((d) => setPoints(d.dropoffs)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setV((old) => ({ ...old, [k]: e.target.value, ...(k === 'campusId' ? { locationId: '' } : {}) }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFields({});
    try {
      const { campusId, ...body } = v; // eslint-disable-line no-unused-vars
      await api.post('/dropoffs', body);
      setV(EMPTY);
      setAdding(false);
      await load();
    } catch (err) {
      setFields(Object.keys(err.fields).length ? err.fields : { form: err.message });
    } finally {
      setBusy(false);
    }
  };
  const buildings = reference.buildings.filter((b) => String(b.campusId) === String(v.campusId));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Drop-off points</h1>
          <p>Hand found items to one of these official points.  The owner collects them with their handover code and ID card.</p>
        </div>
        {ADMIN.includes(user.role) && !adding && <button type="button" className="btn" onClick={() => setAdding(true)}>+ Add a point</button>}
      </div>

      {adding && (
        <form className="card panel dropoff-form" onSubmit={submit} noValidate>
          {fields.form && <div className="alert error">{fields.form}</div>}
          <div className="row">
            <Field id="d-name" label="Name" error={fields.name}>
              <input id="d-name" maxLength={80} value={v.name} onChange={set('name')} placeholder="e.g. Security Office, Irwin Hall" />
            </Field>
            <Field id="d-contact" label="Contact number" error={fields.contactNumber}>
              <input id="d-contact" maxLength={40} value={v.contactNumber} onChange={set('contactNumber')} placeholder="e.g. 01-786456 ext. 1333" />
            </Field>
          </div>
          <div className="dropoff-row">
            <Field id="d-campus" label="Campus">
              <select id="d-campus" value={v.campusId} onChange={set('campusId')}>
                <option value="">Choose a campus</option>
                {reference.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field id="d-building" label="Building" error={fields.locationId}>
              <select id="d-building" value={v.locationId} onChange={set('locationId')} disabled={!v.campusId}>
                <option value="">{v.campusId ? 'Choose a building' : 'Choose a campus first'}</option>
                {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field id="d-opens" label="Opens" error={fields.opensAt}>
              <input id="d-opens" type="time" value={v.opensAt} onChange={set('opensAt')} />
            </Field>
            <Field id="d-closes" label="Closes" error={fields.closesAt}>
              <input id="d-closes" type="time" value={v.closesAt} onChange={set('closesAt')} />
            </Field>
          </div>
          <div className="actions">
            <button type="submit" className="btn" disabled={busy}>Save point</button>
            <button type="button" className="btn secondary" onClick={() => { setAdding(false); setFields({}); }}>Cancel</button>
          </div>
        </form>
      )}

      {error && <div className="alert error">{error}</div>}
      {points && !points.length && <div className="card empty"><h3>No drop-off point yet</h3></div>}
      <div className="dropoff-grid">
        {points?.map((d) => (
          <div key={d.id} className="card dropoff-card">
            <h3>{d.name}</h3>
            <dl>
              <dt>Where</dt><dd>{d.building}, {d.campus} campus</dd>
              <dt>Open</dt><dd>{d.openingHours}</dd>
              <dt>Contact</dt><dd>{d.contactNumber}</dd>
            </dl>
            {STAFF.includes(user.role) && (
              <Link to={`/dropoffs/${d.id}`} className="btn secondary small">
                {d.held} held item{d.held === 1 ? '' : 's'}
              </Link>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
