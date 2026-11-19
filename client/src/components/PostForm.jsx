import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import Field from './Field';
import BuildingPicker from '../modules/map/BuildingPicker';

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_MB = 10;

/* Lost and found post form (FR-2.2, FR-3.2).  `initial` is set when editing; the type is then fixed (FR-10.2). */
export default function PostForm({ type, initial, onSubmit, submitLabel, busy, error }) {
  const { reference, user } = useAuth();
  const [v, setV] = useState(() => ({
    title: '', categoryId: '', campusId: String(user.campusId || ''), locationId: '', date: new Date().toISOString().slice(0, 10),
    time: '', description: '', whereabouts: 'FINDER', dropoffId: '', verificationQuestion: '', verificationAnswer: '',
    ...initial,
  }));
  const [photos, setPhotos] = useState([]);
  const [photoError, setPhotoError] = useState(null);
  const f = error?.fields || {};
  const set = (k) => (e) => setV((old) => ({ ...old, [k]: e.target.value, ...(k === 'campusId' ? { locationId: '' } : {}) }));
  const pickBuilding = useCallback((locationId) => setV((old) => ({ ...old, locationId })), []); // FR-11.3

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), [photos]);

  const addPhotos = (e) => {
    setPhotoError(null);
    const files = [...e.target.files];
    e.target.value = '';
    const bad = files.find((file) => !TYPES.includes(file.type) && !/\.hei[cf]$/i.test(file.name));
    if (bad) return setPhotoError(`${bad.name}: photos must be JPEG, PNG, WebP, or HEIC.`);
    const big = files.find((file) => file.size > MAX_MB * 1024 * 1024);
    if (big) return setPhotoError(`${big.name} is larger than ${MAX_MB} MB.`);
    if (photos.length + files.length > 5) return setPhotoError('At most 5 photos.');
    setPhotos((old) => [...old, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  };

  const category = reference.categories.find((c) => String(c.id) === String(v.categoryId));
  const buildings = reference.buildings.filter((b) => String(b.campusId) === String(v.campusId));
  const dropoffs = reference.dropoffs.filter((d) => !v.campusId || String(d.campusId) === String(v.campusId));
  const editing = Boolean(initial);

  const submit = (e) => {
    e.preventDefault();
    onSubmit(v, photos.map((p) => p.file));
  };

  return (
    <form onSubmit={submit} noValidate>
      {error && <div className="alert error">{error.message}</div>}
      {type === 'FOUND' && (
        <div className="alert warn">
          Do not show identifying details in the description or photos, such as names, ID or card numbers, or faces.
          The owner proves the item is theirs by answering your question.
        </div>
      )}

      <Field id="title" label="Title" hint="(at most 80 characters)" error={f.title}>
        <input id="title" maxLength={80} value={v.title} onChange={set('title')}
          placeholder={type === 'LOST' ? 'e.g. Black iPhone 14 with a blue case' : 'e.g. Phone found in the library'} />
      </Field>

      <div className="row">
        <Field id="category" label="Category" error={f.categoryId}>
          <select id="category" value={v.categoryId} onChange={set('categoryId')}>
            <option value="">Choose a category</option>
            {reference.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field id="campus" label="Campus">
          <select id="campus" value={v.campusId} onChange={set('campusId')}>
            <option value="">Choose a campus</option>
            {reference.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      {category?.sensitive && (
        <div className="alert info">
          {category.name} is a sensitive category: photos are blurred for other users and long numbers are hidden automatically.
        </div>
      )}

      <div className="row3">
        <Field id="building" label="Building" error={f.locationId}>
          <select id="building" value={v.locationId} onChange={set('locationId')} disabled={!v.campusId}>
            <option value="">{v.campusId ? 'Choose a building' : 'Choose a campus first'}</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field id="date" label={type === 'LOST' ? 'Date lost' : 'Date found'} error={f.date}>
          <input id="date" type="date" max={new Date().toISOString().slice(0, 10)} value={v.date} onChange={set('date')} />
        </Field>
        <Field id="time" label="Approximate time" hint="(optional)" error={f.time}>
          <input id="time" type="time" value={v.time} onChange={set('time')} />
        </Field>
      </div>
      <BuildingPicker campus={reference.campuses.find((c) => String(c.id) === String(v.campusId))} buildings={buildings}
        value={v.locationId} onChange={pickBuilding} />

      <Field id="description" label="Description" hint="(at most 1,000 characters)" error={f.description}>
        <textarea id="description" maxLength={1000} value={v.description} onChange={set('description')}
          placeholder="Colour, brand, distinctive marks, what was inside…" />
      </Field>

      {type === 'FOUND' && (
        <>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 1rem' }}>
            <legend style={{ fontWeight: 550, color: 'var(--navy)', fontSize: '0.9rem', marginBottom: '0.4rem' }}>Where is the item now?</legend>
            <div className="segmented" role="group">
              <button type="button" aria-pressed={v.whereabouts === 'FINDER'} onClick={() => setV({ ...v, whereabouts: 'FINDER' })}>I am keeping it</button>
              <button type="button" aria-pressed={v.whereabouts === 'DROPOFF'} onClick={() => setV({ ...v, whereabouts: 'DROPOFF' })}>Handed to a drop-off point</button>
            </div>
          </fieldset>
          {v.whereabouts === 'DROPOFF' && (
            <Field id="dropoff" label="Drop-off point" error={f.dropoffId}>
              <select id="dropoff" value={v.dropoffId || ''} onChange={set('dropoffId')}>
                <option value="">Choose from the official list</option>
                {dropoffs.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.openingHours})</option>)}
              </select>
            </Field>
          )}
          <div className="row">
            <Field id="vq" label="Verification question" hint="(only the owner knows the answer)" error={f.verificationQuestion}>
              <input id="vq" maxLength={200} value={v.verificationQuestion} onChange={set('verificationQuestion')}
                placeholder="e.g. What is the lock-screen picture?" />
            </Field>
            <Field id="va" label="Expected answer" hint={editing ? '(leave empty to keep it)' : '(never shown to others)'} error={f.verificationAnswer}>
              <input id="va" maxLength={200} value={v.verificationAnswer} onChange={set('verificationAnswer')} />
            </Field>
          </div>
        </>
      )}

      {!editing && (
        <div className="field">
          <span style={{ display: 'block', fontWeight: 550, color: 'var(--navy)', fontSize: '0.9rem', marginBottom: '0.4rem' }}>
            Photos <span className="hint">(up to 5; JPEG, PNG, WebP, or HEIC; at most 10 MB each)</span>
          </span>
          <div className="photo-picker">
            {photos.map((p, i) => (
              <div className="tile" key={p.url}>
                <img src={p.url} alt={`Selected photo ${i + 1}`} />
                <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos(photos.filter((x) => x !== p))}>×</button>
              </div>
            ))}
            {photos.length < 5 && (
              <label className="add">
                + Add<br />photo
                <input type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/*" multiple onChange={addPhotos} className="sr-only" />
              </label>
            )}
          </div>
          {photoError && <div className="field-error" role="alert">{photoError}</div>}
        </div>
      )}

      <button className="btn" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}
