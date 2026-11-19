import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import Field from '../../components/Field';
import { ConfirmButton, Notice, run } from './shared';

const num = (v) => (v === '' ? '' : Number(v));
const count = (n, word) => n && `${n} ${word}${n === 1 ? '' : 's'}`;

/* FR-16.6: campuses, their buildings with map coordinates, and categories.  Anything still used by posts (or, for a
   building, by a drop-off point) cannot be deleted; the server explains why. */
export default function Places() {
  const { refresh } = useAuth();
  const [data, setData] = useState(null);
  const [campusId, setCampusId] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const d = await api.get('/admin/places');
    setData(d);
    setCampusId((id) => (d.campuses.some((c) => c.id === id) ? id : d.campuses[0]?.id ?? null));
  }, []);
  useEffect(() => { load().catch((e) => setNotice({ kind: 'error', text: e.message })); }, [load]);
  if (!data) return <Notice notice={notice} />;

  /** Runs a change and reloads; returns the field errors for the form that made it. */
  const change = async (fn, success) => {
    const errors = await run(setNotice, fn, success);
    await load();
    if (!Object.keys(errors).length) refresh(); // the post forms and the map use the new lists at once
    return errors;
  };
  const campus = data.campuses.find((c) => c.id === campusId);
  const buildings = data.buildings.filter((b) => b.campusId === campusId);

  return (
    <>
      <Notice notice={notice} />
      <section className="card panel admin-section">
        <h2>Campuses and buildings</h2>
        <div className="segmented" role="group" aria-label="Campus">
          {data.campuses.map((c) => (
            <button key={c.id} type="button" aria-pressed={c.id === campusId} onClick={() => setCampusId(c.id)}>{c.name}</button>
          ))}
        </div>
        {campus && (
          <>
            <h3 className="section-title">{campus.name} <span className="hint">(campus centre {campus.latitude}, {campus.longitude})</span></h3>
            <div className="table-scroll"><table className="admin-table">
              <thead><tr><th>Building</th><th>Latitude</th><th>Longitude</th><th>Used by</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {buildings.map((b) => (
                  <PlaceRow key={b.id} item={b} uses={[count(b.posts, 'post'), count(b.dropoffs, 'drop-off point')]}
                    onSave={(v) => change(() => api.patch(`/buildings/${b.id}`, { ...v, campusId }), `${v.name} saved.`)}
                    onDelete={() => change(() => api.del(`/buildings/${b.id}`), `${b.name} deleted.`)} />
                ))}
              </tbody>
            </table></div>
            {!buildings.length && <p className="hint">No building yet.</p>}
            <PlaceForm idPrefix="b" title="Add a building" nameLabel="Building"
              onSubmit={(v) => change(() => api.post('/buildings', { ...v, campusId }), `${v.name} added to ${campus.name}.`)} />
          </>
        )}
        <div className="subpanel">
          <h3 className="section-title">Campuses</h3>
          <div className="table-scroll"><table className="admin-table">
            <thead><tr><th>Campus</th><th>Latitude</th><th>Longitude</th><th>Buildings</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {data.campuses.map((c) => {
                const n = data.buildings.filter((b) => b.campusId === c.id).length;
                return (
                  <PlaceRow key={c.id} item={c} uses={[count(n, 'building')]}
                    onSave={(v) => change(() => api.patch(`/campuses/${c.id}`, v), `${v.name} saved.`)}
                    onDelete={() => change(() => api.del(`/campuses/${c.id}`), `${c.name} deleted.`)} />
                );
              })}
            </tbody>
          </table></div>
          <PlaceForm idPrefix="c" title="Add a campus" nameLabel="Campus"
            onSubmit={(v) => change(() => api.post('/campuses', v), `${v.name} added.`)} />
        </div>
      </section>

      <Categories categories={data.categories} change={change} />
    </>
  );
}

/** A building or campus row, which turns into an edit form. */
function PlaceRow({ item, uses, onSave, onDelete }) {
  const [edit, setEdit] = useState(null);
  const [errors, setErrors] = useState({});
  const used = uses.filter(Boolean);
  if (edit) {
    const save = async () => {
      const e = await onSave(edit);
      setErrors(e);
      if (!Object.keys(e).length) setEdit(null);
    };
    return (
      <tr className="editing">
        <td><input aria-label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-invalid={Boolean(errors.name)} /></td>
        <td><input aria-label="Latitude" type="number" step="0.00001" value={edit.latitude} aria-invalid={Boolean(errors.latitude)}
          onChange={(e) => setEdit({ ...edit, latitude: num(e.target.value) })} /></td>
        <td><input aria-label="Longitude" type="number" step="0.00001" value={edit.longitude} aria-invalid={Boolean(errors.longitude)}
          onChange={(e) => setEdit({ ...edit, longitude: num(e.target.value) })} /></td>
        <td className="hint">{errors.name || errors.latitude || errors.longitude}</td>
        <td className="row-actions">
          <button type="button" className="btn small" onClick={save}>Save</button>
          <button type="button" className="btn secondary small" onClick={() => { setEdit(null); setErrors({}); }}>Cancel</button>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td>{item.name}</td>
      <td>{item.latitude}</td>
      <td>{item.longitude}</td>
      <td className="hint">{used.length ? used.join(', ') : 'Nothing'}</td>
      <td className="row-actions">
        <button type="button" className="btn secondary small"
          onClick={() => setEdit({ name: item.name, latitude: item.latitude, longitude: item.longitude })}>Edit</button>
        <ConfirmButton onConfirm={onDelete} />
      </td>
    </tr>
  );
}

function PlaceForm({ idPrefix, title, nameLabel, onSubmit }) {
  const empty = { name: '', latitude: '', longitude: '' };
  const [v, setV] = useState(empty);
  const [errors, setErrors] = useState({});
  const submit = async (e) => {
    e.preventDefault();
    const errs = await onSubmit(v);
    setErrors(errs);
    if (!Object.keys(errs).length) setV(empty);
  };
  return (
    <form className="inline-form add-form" onSubmit={submit} noValidate>
      <Field id={`${idPrefix}-name`} label={title} error={errors.name}>
        <input id={`${idPrefix}-name`} maxLength={80} value={v.name} placeholder={nameLabel} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </Field>
      <Field id={`${idPrefix}-lat`} label="Latitude" error={errors.latitude}>
        <input id={`${idPrefix}-lat`} type="number" step="0.00001" value={v.latitude} placeholder="33.89290" onChange={(e) => setV({ ...v, latitude: num(e.target.value) })} />
      </Field>
      <Field id={`${idPrefix}-lng`} label="Longitude" error={errors.longitude}>
        <input id={`${idPrefix}-lng`} type="number" step="0.00001" value={v.longitude} placeholder="35.47760" onChange={(e) => setV({ ...v, longitude: num(e.target.value) })} />
      </Field>
      <button className="btn">Add</button>
    </form>
  );
}

function Categories({ categories, change }) {
  const [name, setName] = useState('');
  const [sensitive, setSensitive] = useState(false);
  const [errors, setErrors] = useState({});
  const [editing, setEditing] = useState(null); // { id, name, sensitive }

  const add = async (e) => {
    e.preventDefault();
    const errs = await change(() => api.post('/categories', { name, sensitive }), `${name.trim()} added.`);
    setErrors(errs);
    if (!Object.keys(errs).length) { setName(''); setSensitive(false); }
  };
  const save = async () => {
    const errs = await change(() => api.patch(`/categories/${editing.id}`, { name: editing.name, sensitive: editing.sensitive }), `${editing.name.trim()} saved.`);
    if (!Object.keys(errs).length) setEditing(null);
  };

  return (
    <section className="card panel admin-section">
      <h2>Categories</h2>
      <p className="hint">Photos of sensitive categories are blurred for other users, and long numbers in their posts are hidden (FR-17).</p>
      <div className="table-scroll"><table className="admin-table">
        <thead><tr><th>Category</th><th>Sensitive</th><th>Posts</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {categories.map((c) => (editing?.id === c.id ? (
            <tr key={c.id} className="editing">
              <td><input aria-label="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></td>
              <td><input aria-label="Sensitive" type="checkbox" checked={editing.sensitive} onChange={(e) => setEditing({ ...editing, sensitive: e.target.checked })} /></td>
              <td>{c.posts}</td>
              <td className="row-actions">
                <button type="button" className="btn small" onClick={save}>Save</button>
                <button type="button" className="btn secondary small" onClick={() => setEditing(null)}>Cancel</button>
              </td>
            </tr>
          ) : (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.sensitive ? <span className="badge sensitive">Sensitive</span> : <span className="hint">No</span>}</td>
              <td>{c.posts}</td>
              <td className="row-actions">
                <button type="button" className="btn secondary small" onClick={() => setEditing({ id: c.id, name: c.name, sensitive: c.sensitive })}>Edit</button>
                <ConfirmButton onConfirm={() => change(() => api.del(`/categories/${c.id}`), `${c.name} deleted.`)} />
              </td>
            </tr>
          )))}
        </tbody>
      </table></div>
      <form className="inline-form add-form" onSubmit={add} noValidate>
        <Field id="cat-name" label="Add a category" error={errors.name}>
          <input id="cat-name" maxLength={60} value={name} placeholder="Category" onChange={(e) => setName(e.target.value)} />
        </Field>
        <label className="check"><input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} /> Sensitive</label>
        <button className="btn">Add</button>
      </form>
    </section>
  );
}
