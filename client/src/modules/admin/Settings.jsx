import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import Field from '../../components/Field';
import { Notice, run } from './shared';

const KARMA = [
  ['RETURN', 'Item returned to its owner'],
  ['DROPOFF', 'Item handed to a drop-off point'],
  ['HELPFUL_REPORT', 'Report upheld by a moderator'],
  ['FRAUD', 'Content removed for fraud'],
];

/* FR-16.8: the data retention period and the karma points of Table 13.  The Smart Match thresholds and weights
   have their own page (FR-5.8). */
export default function Settings() {
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);

  useEffect(() => { api.get('/admin/settings').then(setForm).catch((e) => setNotice({ kind: 'error', text: e.message })); }, []);
  if (!form) return <Notice notice={notice} />;

  const num = (v) => (v === '' ? '' : Number(v));
  const save = async (e) => {
    e.preventDefault();
    let saved;
    const errs = await run(setNotice, async () => { saved = await api.put('/admin/settings', form); }, 'Parameters saved.  They apply from now on.');
    setErrors(errs);
    if (saved) setForm({ ...form, ...saved });
  };

  return (
    <form className="card panel admin-section" onSubmit={save} noValidate>
      <h2>Parameters</h2>
      <Notice notice={notice} />
      <h3 className="section-title">Data retention</h3>
      <div className="row">
        <Field id="retention" label="Retention period of closed posts" hint="(1 to 60 months)" error={errors.retentionMonths}>
          <input id="retention" type="number" min={1} max={60} value={form.retentionMonths}
            onChange={(e) => setForm({ ...form, retentionMonths: num(e.target.value) })} />
        </Field>
      </div>
      <h3 className="section-title">Karma points</h3>
      <p className="hint">From 1 to 100 points for each action; the fraud penalty is from −100 to −1.</p>
      {!form.karmaEnabled && <div className="alert info">Karma is turned off for your organization, so no points are awarded.</div>}
      <div className="row">
        {KARMA.map(([key, label]) => (
          <Field key={key} id={`k-${key}`} label={label} error={errors[`karmaRules.${key}`]}>
            <input id={`k-${key}`} type="number" min={key === 'FRAUD' ? -100 : 1} max={key === 'FRAUD' ? -1 : 100}
              value={form.karmaRules[key]} onChange={(e) => setForm({ ...form, karmaRules: { ...form.karmaRules, [key]: num(e.target.value) } })} />
          </Field>
        ))}
      </div>
      <p className="hint">The Smart Match thresholds and weights are on the <Link to="/admin/matching">Smart Match settings</Link> page.</p>
      <div className="actions">
        <button className="btn">Save parameters</button>
      </div>
    </form>
  );
}
