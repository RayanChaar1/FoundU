import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import Field from '../components/Field';

/* FR-1.3 to FR-1.7: sign in with a one-time code sent to the organization email, then create the profile. */
export default function SignIn() {
  const { refresh, notice } = useAuth();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [org, setOrg] = useState('');
  const [campuses, setCampuses] = useState([]);
  const [fullName, setFullName] = useState('');
  const [campusId, setCampusId] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = (fn) => async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const sendCode = run(async () => {
    const res = await api.post('/auth/start', { email });
    setOrg(res.organization);
    setCode('');
    setStep('code');
  });

  const verify = run(async () => {
    const res = await api.post('/auth/verify', { email, code });
    if (res.signedIn) return refresh();
    setCampuses(res.campuses);
    setStep('profile');
  });

  const createProfile = run(async () => {
    await api.post('/auth/profile', { fullName, campusId });
    await refresh();
  });

  return (
    <div className="auth-page">
      <section className="auth-hero">
        <div className="brand">
          <img src="/icon.png" alt="" style={{ width: 40, height: 40 }} />
          FoundU
        </div>
        <div>
          <h1>Lost something? Find your way back to it.</h1>
          <p>The lost and found of your campus: post an item, get matched automatically, prove it is yours, and get it back safely.</p>
          <ul>
            <li>✓ Only members of your organization can sign in</li>
            <li>✓ Smart Match connects lost and found items</li>
            <li>✓ A secret question stops false claims</li>
            <li>✓ Your email and phone number stay private</li>
          </ul>
        </div>
        <small style={{ color: '#bcd2ff' }}>CSC490 Software Engineering · LAU · Team AJMR²</small>
      </section>

      <section className="auth-form">
        <div className="card">
          {step === 'email' && (
            <form onSubmit={sendCode} noValidate>
              <h2>Sign in</h2>
              <p className="hint">Use the email address of your university or company.</p>
              {notice && !error && <div className="alert info" role="status">{notice}</div>}
              {error && <div className="alert error">{error.message}</div>}
              <Field id="email" label="Organization email" error={error?.fields?.email}>
                <input id="email" type="email" autoComplete="email" autoFocus required value={email}
                  placeholder="name@lau.edu" onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <button className="btn block" disabled={busy || !email}>{busy ? 'Sending…' : 'Send me a code'}</button>
              <p className="hint" style={{ marginTop: '1rem', textAlign: 'center' }}>
                Is your organization not on FoundU yet?  <Link to="/join">Request access</Link>
              </p>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={verify} noValidate>
              <h2>Check your email</h2>
              <p className="hint">We sent a 6-digit code to <strong>{email}</strong> ({org}).  It expires in 10 minutes.</p>
              {error && <div className="alert error">{error.message}</div>}
              <Field id="code" label="Code" error={error?.fields?.code}>
                <input id="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <button className="btn block" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign in'}</button>
              <p style={{ marginTop: '1rem', textAlign: 'center' }}>
                <button type="button" className="btn secondary small" onClick={() => setStep('email')}>Use another email</button>
              </p>
            </form>
          )}

          {step === 'profile' && (
            <form onSubmit={createProfile} noValidate>
              <h2>Welcome to FoundU</h2>
              <p className="hint">Tell us who you are to create your profile.</p>
              {error && !Object.keys(error.fields).length && <div className="alert error">{error.message}</div>}
              <Field id="fullName" label="Full name" error={error?.fields?.fullName}>
                <input id="fullName" autoComplete="name" autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </Field>
              <Field id="campus" label="Campus" error={error?.fields?.campusId}>
                <select id="campus" value={campusId} onChange={(e) => setCampusId(e.target.value)}>
                  <option value="">Choose your campus</option>
                  {campuses.map((c) => <option key={c.campus_id} value={c.campus_id}>{c.name}</option>)}
                </select>
              </Field>
              <button className="btn block" disabled={busy}>Create my profile</button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
