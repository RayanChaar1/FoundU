import { useEffect, useRef, useState } from 'react';

export const ROLE_LABEL = { USER: 'User', SECURITY: 'Security officer', ORG_ADMIN: 'Administrator', PLATFORM_ADMIN: 'Platform administrator' };
export const ORG_ROLES = ['USER', 'SECURITY', 'ORG_ADMIN'];

/** A delete button that asks for a second click instead of a browser dialog. */
export function ConfirmButton({ label = 'Delete', confirm = 'Confirm delete', onConfirm, disabled }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return <button type="button" className="btn danger small" disabled={disabled} onClick={() => setArmed(true)}>{label}</button>;
  }
  return (
    <span className="confirm">
      <button type="button" className="btn danger small" onClick={() => { setArmed(false); onConfirm(); }}>{confirm}</button>
      <button type="button" className="btn secondary small" onClick={() => setArmed(false)}>Cancel</button>
    </span>
  );
}

/** Status line above a form or a table: { kind: 'success' | 'error', text }.  It scrolls into view when it changes. */
export function Notice({ notice }) {
  const box = useRef(null);
  useEffect(() => { box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [notice]);
  return notice ? <div ref={box} className={`alert ${notice.kind}`} role="status">{notice.text}</div> : null;
}

/** Runs an API call and reports its outcome.  Returns {} on success, otherwise the field errors (with `_` set, so a
    failure without field errors is never taken for a success). */
export async function run(setNotice, fn, success) {
  setNotice(null);
  try {
    await fn();
    if (success) setNotice({ kind: 'success', text: success });
    return {};
  } catch (err) {
    setNotice({ kind: 'error', text: err.message });
    return { ...err.fields, _: err.message };
  }
}
