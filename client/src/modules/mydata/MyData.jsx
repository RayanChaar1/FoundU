import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../api';
import { useAuth } from '../../auth';
import Field from '../../components/Field';

/* FR-17.6: download my data; NFR-22: correct it; FR-17.7: delete it. */
export default function MyData() {
  const { user, reference, refresh, setNotice } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: user.fullName, displayName: user.displayName, campusId: user.campusId || '' });
  const [fields, setFields] = useState({});
  const [saved, setSaved] = useState(null);
  const [confirm, setConfirm] = useState('');
  const [deleteError, setDeleteError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setFields({});
    setSaved(null);
    try {
      await api.patch('/me/profile', { ...form, campusId: Number(form.campusId) });
      await refresh();
      setSaved('Your details are saved.');
    } catch (err) {
      setFields(err.fields);
    }
  };

  const remove = async (e) => {
    e.preventDefault();
    setDeleteError(null);
    setBusy(true);
    try {
      await api.del('/me', { confirm });
      setNotice('Your data was deleted.  Thank you for using FoundU.');
      await refresh(); // the session has ended
      navigate('/', { replace: true });
    } catch (err) {
      setDeleteError(err.fields.confirm || err.message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head"><h1>My data</h1></div>
      <div className="mydata-grid">
        <form className="card panel" onSubmit={save} noValidate>
          <h2 className="section-title">Your details</h2>
          <p className="hint">Correct what FoundU shows about you.  Other users see only your display name.</p>
          {saved && <div className="alert success" role="status">{saved}</div>}
          <Field id="md-full" label="Full name" error={fields.fullName}>
            <input id="md-full" value={form.fullName} onChange={set('fullName')} maxLength={100} autoComplete="name" />
          </Field>
          <Field id="md-display" label="Display name" hint="(shown to other users)" error={fields.displayName}>
            <input id="md-display" value={form.displayName} onChange={set('displayName')} maxLength={60} />
          </Field>
          <Field id="md-campus" label="Campus" error={fields.campusId}>
            <select id="md-campus" value={form.campusId} onChange={set('campusId')}>
              {reference.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <p className="hint">Your email address ({user.email}) comes from your organization and cannot be changed here.</p>
          <button className="btn">Save my details</button>
        </form>

        <div className="activity-side">
          <section className="card panel">
            <h2 className="section-title">Download your data</h2>
            <p>One file (JSON) with everything FoundU holds about you:</p>
            <ul className="mydata-list">
              <li>your profile and preferences;</li>
              <li>your posts, with their changes and verification answers;</li>
              <li>your claims, messages and &quot;I may have found this&quot; messages;</li>
              <li>your notifications, karma points, reports and QR tags.</li>
            </ul>
            <a className="btn secondary" href="/api/me/data" download="foundu-my-data.json">Download my data</a>
          </section>

          <form className="card panel danger-zone" onSubmit={remove} noValidate>
            <h2 className="section-title">Delete your data</h2>
            <p>Your profile, claims, messages, notifications, karma points and QR tags are deleted at once, and you are signed out.  Your posts are closed and kept only without any personal data, for your organization&apos;s statistics.  This cannot be undone.</p>
            <div className="confirm-row">
              <Field id="md-confirm" label="Type DELETE to confirm" error={deleteError}>
                <input id="md-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
              </Field>
              <button className="btn danger" disabled={busy || confirm !== 'DELETE'}>Delete my data</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
