/** Labelled form field that highlights itself and shows the server's message when invalid (FR-2.5). */
export default function Field({ id, label, hint, error, children }) {
  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      <label htmlFor={id}>
        {label} {hint && <span className="hint">{hint}</span>}
      </label>
      {children}
      {error && (
        <div className="field-error" id={`${id}-error`} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
