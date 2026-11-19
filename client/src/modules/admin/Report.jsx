import { useState } from 'react';
import { query } from '../../api';
import Field from '../../components/Field';
import { Notice } from './shared';

const iso = (d) => d.toISOString().slice(0, 10);
const firstOfMonth = () => { const d = new Date(); return iso(new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1))); };

/* FR-16.9: a CSV file of the posts created over a date range, with their status and return date. */
export default function Report() {
  const [range, setRange] = useState({ from: firstOfMonth(), to: iso(new Date()) });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const download = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/report.csv${query(range)}`, { credentials: 'same-origin' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrors(body.fields || {});
        throw new Error(body.error || 'The report could not be created.');
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'foundu-posts.csv';
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice({ kind: 'success', text: `${name} downloaded.` });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card panel admin-section" onSubmit={download} noValidate>
      <h2>Posts report</h2>
      <p className="hint">A CSV file (opens in Excel) with every post created in the period: type, title, category, place, status, and whether and when it was returned.</p>
      <Notice notice={notice} />
      <div className="inline-form">
        <Field id="from" label="From" error={errors.from}>
          <input id="from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </Field>
        <Field id="to" label="To (included)" error={errors.to}>
          <input id="to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </Field>
        <button className="btn" disabled={busy}>{busy ? 'Preparing…' : 'Download CSV'}</button>
      </div>
    </form>
  );
}
