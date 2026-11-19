import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { formatDate } from '../../format';
import Field from '../../components/Field';

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY = { title: '', categoryId: '', locationId: '', date: today(), time: '', description: '', verificationQuestion: '', verificationAnswer: '' };

/* The officer's desk at one point: held items (FR-14.7), recording received items (FR-14.3),
   posting an item handed in by a visitor (FR-14.4), and releasing through the claim page (FR-14.5, FR-14.6). */
export default function DropoffDesk() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { reference } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [postId, setPostId] = useState('');
  const [receiveError, setReceiveError] = useState(null);
  const [visitor, setVisitor] = useState(false);
  const [v, setV] = useState(EMPTY);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/dropoffs/${id}/items`).then(setData).catch(setError);
  }, [id]);

  if (error) {
    return (
      <div className="card empty">
        <h3>{error.status === 404 ? 'This drop-off point does not exist' : error.message}</h3>
        <Link to="/dropoffs">Back to the drop-off points</Link>
      </div>
    );
  }
  if (!data) return null;
  const { point } = data;

  const receive = async (pid) => {
    setBusy(true);
    setReceiveError(null);
    try {
      setData(await api.post(`/dropoffs/${id}/items`, { postId: Number(pid) }));
      setNotice(`Post #${pid} is recorded as held at ${point.name}.`);
      setPostId('');
    } catch (e) {
      setReceiveError(Object.values(e.fields)[0] || e.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setV((old) => ({ ...old, [k]: e.target.value }));
  const postForVisitor = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFields({});
    try {
      const res = await api.post(`/dropoffs/${id}/posts`, v);
      navigate(`/posts/${res.id}`);
    } catch (err) {
      setFields(Object.keys(err.fields).length ? err.fields : { form: err.message });
      setBusy(false);
    }
  };
  const buildings = reference.buildings.filter((b) => b.campusId === point.campusId);

  return (
    <>
      <p><Link to="/dropoffs">← All drop-off points</Link></p>
      <div className="page-head">
        <div>
          <h1>{point.name}</h1>
          <p>{point.building}, {point.campus} campus · {point.openingHours} · {point.contactNumber}</p>
        </div>
        {!visitor && <button type="button" className="btn" onClick={() => setVisitor(true)}>+ Item from a visitor</button>}
      </div>
      {notice && <div className="alert success">{notice}</div>}

      {visitor && (
        <form className="card panel dropoff-form" onSubmit={postForVisitor} noValidate>
          <h2>Item handed in by a visitor</h2>
          <p className="hint">The finder has no FoundU account.  The post is published under your name and shows the item as held here.</p>
          {fields.form && <div className="alert error">{fields.form}</div>}
          <Field id="v-title" label="Title" error={fields.title}>
            <input id="v-title" maxLength={80} value={v.title} onChange={set('title')} placeholder="e.g. Car keys with a red key ring" />
          </Field>
          <div className="dropoff-row">
            <Field id="v-cat" label="Category" error={fields.categoryId}>
              <select id="v-cat" value={v.categoryId} onChange={set('categoryId')}>
                <option value="">Choose a category</option>
                {reference.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field id="v-bld" label="Where it was found" error={fields.locationId}>
              <select id="v-bld" value={v.locationId} onChange={set('locationId')}>
                <option value="">Choose a building</option>
                {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field id="v-date" label="Date found" error={fields.date}>
              <input id="v-date" type="date" max={today()} value={v.date} onChange={set('date')} />
            </Field>
            <Field id="v-time" label="Time" hint="(optional)" error={fields.time}>
              <input id="v-time" type="time" value={v.time} onChange={set('time')} />
            </Field>
          </div>
          <Field id="v-desc" label="Description" hint="(no names or card numbers)" error={fields.description}>
            <textarea id="v-desc" maxLength={1000} value={v.description} onChange={set('description')} />
          </Field>
          <div className="row">
            <Field id="v-q" label="Verification question" error={fields.verificationQuestion}>
              <input id="v-q" maxLength={200} value={v.verificationQuestion} onChange={set('verificationQuestion')} />
            </Field>
            <Field id="v-a" label="Expected answer" error={fields.verificationAnswer}>
              <input id="v-a" maxLength={200} value={v.verificationAnswer} onChange={set('verificationAnswer')} />
            </Field>
          </div>
          <div className="actions">
            <button type="submit" className="btn" disabled={busy}>Publish</button>
            <button type="button" className="btn secondary" onClick={() => { setVisitor(false); setFields({}); }}>Cancel</button>
          </div>
        </form>
      )}

      <div className="desk-layout">
        <section className="card panel">
          <h2>Held items ({data.held.length})</h2>
          {data.held.length ? (
            <table className="desk-table">
              <thead><tr><th>Item</th><th>Received</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.held.map((i) => (
                  <tr key={i.id}>
                    <td><Link to={`/posts/${i.id}`}>{i.title}</Link><div className="hint">#{i.id} · {i.category} · found in {i.building}</div></td>
                    <td>{formatDate(i.receivedAt, true)}</td>
                    <td>{i.status === 'CLAIMED' ? <span className="badge found">Claimed by {i.claimant}</span> : <span className="badge status">Waiting</span>}</td>
                    <td>{i.claimId && <Link className="btn small" to={`/claims/${i.claimId}`}>Release</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="hint">No item is held here.</p>}
        </section>

        <aside className="card panel">
          <h2>Record a received item</h2>
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); receive(postId); }} noValidate>
            <Field id="r-post" label="Found post number" error={receiveError}>
              <input id="r-post" inputMode="numeric" value={postId} onChange={(e) => setPostId(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 42" />
            </Field>
            <button type="submit" className="btn" disabled={busy || !postId} style={{ marginTop: '1.7rem' }}>Record</button>
          </form>
          <h3 style={{ marginTop: '1rem' }}>Announced for this point</h3>
          {data.expected.length ? (
            <ul className="desk-expected">
              {data.expected.map((i) => (
                <li key={i.id}>
                  <span><Link to={`/posts/${i.id}`}>{i.title}</Link><span className="hint"> · #{i.id} by {i.finder}</span></span>
                  <button type="button" className="btn secondary small" disabled={busy} onClick={() => receive(i.id)}>Received</button>
                </li>
              ))}
            </ul>
          ) : <p className="hint">No finder has announced an item for this point.</p>}
        </aside>
      </div>
    </>
  );
}
