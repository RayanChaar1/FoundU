import { useEffect, useState } from 'react';
import { api } from '../api';
import Field from '../components/Field';

const WEIGHTS = [
  ['category', 'Same category'],
  ['building', 'Same building'],
  ['campus', 'Same campus only'],
  ['date1', 'Dates at most 1 day apart'],
  ['date3', 'Dates 2 to 3 days apart'],
  ['date7', 'Dates 4 to 7 days apart'],
  ['keywords', 'Shared keywords (max)'],
];

/* FR-5.8, FR-5.9: the organization administrator tunes the Smart Match thresholds and weights (Table 12). */
export default function MatchSettings() {
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/admin/matching').then(setForm).catch((e) => setNotice({ kind: 'error', text: e.message })); }, []);
  if (!form) return notice ? <div className="alert error">{notice.text}</div> : null;

  const num = (v) => (v === '' ? '' : Number(v));
  const max = form.weights.category + Math.max(form.weights.building, form.weights.campus)
    + Math.max(form.weights.date1, form.weights.date3, form.weights.date7) + form.weights.keywords;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setNotice(null);
    try {
      setForm(await api.put('/admin/matching', form));
      setNotice({ kind: 'success', text: 'Smart Match settings saved.  They apply to every new post.' });
    } catch (err) {
      setErrors(err.fields || {});
      setNotice({ kind: 'error', text: err.fields?.weights || err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card panel form-card" onSubmit={save} noValidate style={{ maxWidth: 760 }}>
      <h1>Smart Match settings</h1>
      <p className="hint">A pair scoring at or above the match threshold is recorded and its owner notified; a pair at or above the possible-match threshold is only listed.</p>
      {notice && <div className={`alert ${notice.kind}`} role="status">{notice.text}</div>}
      <div className="row">
        <Field id="matchThreshold" label="Match threshold" hint="(0 to 100)" error={errors.matchThreshold}>
          <input id="matchThreshold" type="number" min={0} max={100} value={form.matchThreshold}
            onChange={(e) => setForm({ ...form, matchThreshold: num(e.target.value) })} />
        </Field>
        <Field id="possibleThreshold" label="Possible-match threshold" hint="(0 to 100)" error={errors.possibleThreshold}>
          <input id="possibleThreshold" type="number" min={0} max={100} value={form.possibleThreshold}
            onChange={(e) => setForm({ ...form, possibleThreshold: num(e.target.value) })} />
        </Field>
      </div>
      <h2 className="section-title">Weights <span className="hint">(highest possible score: {max} of 100)</span></h2>
      <div className="row3">
        {WEIGHTS.map(([key, label]) => (
          <Field key={key} id={`w-${key}`} label={label} error={errors[`weights.${key}`]}>
            <input id={`w-${key}`} type="number" min={0} max={100} value={form.weights[key]}
              onChange={(e) => setForm({ ...form, weights: { ...form.weights, [key]: num(e.target.value) } })} />
          </Field>
        ))}
      </div>
      <div className="actions">
        <button type="submit" className="btn" disabled={busy}>Save settings</button>
      </div>
    </form>
  );
}
