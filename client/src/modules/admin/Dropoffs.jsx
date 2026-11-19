import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import Field from '../../components/Field';
import { ConfirmButton, Notice, run } from './shared';

const EMPTY = { name: '', locationId: '', opensAt: '08:00', closesAt: '17:00', contactNumber: '' };
const split = (hours) => {
  const [opensAt = '', closesAt = ''] = (hours || '').split(' to ');
  return { opensAt, closesAt };
};

/* FR-16.7 (and FR-14.2 for adding): the official drop-off points.  A point that holds items cannot be removed. */
export default function Dropoffs() {
  const { reference, refresh } = useAuth();
  const [points, setPoints] = useState(null);
  const [editing, setEditing] = useState(null); // dropoff id, or 'new'
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => setPoints((await api.get('/dropoffs')).dropoffs), []);
  useEffect(() => { load().catch((e) => setNotice({ kind: 'error', text: e.message })); }, [load]);

  const change = async (fn, success) => {
    const errors = await run(setNotice, fn, success);
    await load();
    if (!errors._) { setEditing(null); refresh(); }
    return errors;
  };
  if (!points) return <Notice notice={notice} />;

  return (
    <section className="card panel admin-section">
      <div className="section-head">
        <h2>Drop-off points</h2>
        {editing !== 'new' && <button type="button" className="btn" onClick={() => setEditing('new')}>Add a point</button>}
      </div>
      <Notice notice={notice} />
      {editing === 'new' && (
        <PointForm initial={EMPTY} buildings={reference.buildings} campuses={reference.campuses} submitLabel="Add point"
          onCancel={() => setEditing(null)}
          onSubmit={(v) => change(() => api.post('/dropoffs', v), `${v.name} added to the official list.`)} />
      )}
      <table className="admin-table">
        <thead><tr><th>Point</th><th>Building</th><th>Hours</th><th>Holds</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {points.map((d) => (editing === d.id ? (
            <tr key={d.id} className="editing">
              <td colSpan={5}>
                <PointForm initial={{ name: d.name, locationId: d.locationId, contactNumber: d.contactNumber, ...split(d.openingHours) }}
                  buildings={reference.buildings} campuses={reference.campuses} submitLabel="Save point"
                  onCancel={() => setEditing(null)}
                  onSubmit={(v) => change(() => api.patch(`/dropoffs/${d.id}`, v), `${v.name} saved.`)} />
              </td>
            </tr>
          ) : (
            <tr key={d.id}>
              <td>{d.name}<div className="hint">{d.contactNumber}</div></td>
              <td>{d.building} <span className="hint">({d.campus})</span></td>
              <td className="nowrap">{d.openingHours}</td>
              <td className="nowrap">{d.held} item{d.held === 1 ? '' : 's'}</td>
              <td className="row-actions">
                <button type="button" className="btn secondary small" onClick={() => setEditing(d.id)}>Edit</button>
                <ConfirmButton label="Remove" confirm="Confirm removal"
                  onConfirm={() => change(() => api.del(`/dropoffs/${d.id}`), `${d.name} removed from the official list.`)} />
              </td>
            </tr>
          )))}
        </tbody>
      </table>
      {!points.length && <p className="empty">No drop-off point yet.</p>}
    </section>
  );
}

function PointForm({ initial, buildings, campuses, submitLabel, onSubmit, onCancel }) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setErrors(await onSubmit({ ...v, locationId: v.locationId ? Number(v.locationId) : '' }));
  };
  return (
    <form className="point-form" onSubmit={submit} noValidate>
      <div className="row">
        <Field id="p-name" label="Name" error={errors.name}>
          <input id="p-name" maxLength={80} value={v.name} onChange={set('name')} placeholder="e.g. Security Office, Irwin Hall" />
        </Field>
        <Field id="p-building" label="Building" error={errors.locationId}>
          <select id="p-building" value={v.locationId} onChange={set('locationId')}>
            <option value="">Choose a building</option>
            {campuses.map((c) => (
              <optgroup key={c.id} label={c.name}>
                {buildings.filter((b) => b.campusId === c.id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
      </div>
      <div className="row3">
        <Field id="p-opens" label="Opens at" error={errors.opensAt}>
          <input id="p-opens" type="time" value={v.opensAt} onChange={set('opensAt')} />
        </Field>
        <Field id="p-closes" label="Closes at" error={errors.closesAt}>
          <input id="p-closes" type="time" value={v.closesAt} onChange={set('closesAt')} />
        </Field>
        <Field id="p-contact" label="Contact number" error={errors.contactNumber}>
          <input id="p-contact" maxLength={40} value={v.contactNumber} onChange={set('contactNumber')} placeholder="01-786456 ext. 1111" />
        </Field>
      </div>
      <div className="actions">
        <button className="btn">{submitLabel}</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
