import { useState } from 'react';
import { api } from '../../api';
import Field from '../../components/Field';
import { REASONS } from './shared';

/* FR-15.1, FR-15.2: "Report this post" at the bottom of another user's post. */
export default function ReportPanel({ post }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [fields, setFields] = useState({});
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);

  if (post.isOwner || post.status === 'REMOVED') return null;
  if (done) return <div className="alert success report-done">{done}</div>;
  if (!open) {
    return <button type="button" className="map-link report-link" onClick={() => setOpen(true)}>Report this post</button>;
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFields({});
    try {
      await api.post('/reports', { postId: post.id, reason: reason || undefined, details: details || undefined });
      setDone('Thank you.  A moderator will review your report.');
    } catch (err) {
      if (err.status === 409) setDone(err.message);
      else setFields(Object.keys(err.fields).length ? err.fields : { form: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card panel report-form" onSubmit={submit} noValidate>
      <h3>Report this post</h3>
      {fields.form && <div className="alert error">{fields.form}</div>}
      <div>
        <Field id="r-reason" label="Reason" error={fields.reason}>
          <select id="r-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Choose a reason</option>
            {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field id="r-details" label="Details" hint="(optional)" error={fields.details}>
          <input id="r-details" maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>
      </div>
      <div className="actions">
        <button type="submit" className="btn danger" disabled={busy}>Send report</button>
        <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
