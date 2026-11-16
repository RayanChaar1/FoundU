import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { claimLabel, formatDate, timeAgo } from '../format';
import Field from '../components/Field';

/* FR-6.7 to FR-6.12 and FR-9.3 to FR-9.10: review a claim, show the handover code, confirm or cancel the return. */
export default function ClaimDetail() {
  const { id } = useParams();
  const [claim, setClaim] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [mode, setMode] = useState(null); // 'reject' | 'cancel'
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/claims/${id}`).then((d) => setClaim(d.claim)).catch(setError);
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="card empty">
        <h3>{error.status === 403 ? 'Only the claimant and the finder can open this claim' : error.status === 404 ? 'This claim does not exist' : error.message}</h3>
        <Link to="/claims">Back to your claims</Link>
      </div>
    );
  }
  if (!claim) return null;

  const act = async (path, body, success) => {
    setBusy(true);
    setFieldError(null);
    try {
      const res = await api.post(`/claims/${id}/${path}`, body);
      setClaim(res.claim);
      setNotice({ kind: 'success', text: success });
      setMode(null);
      setReason('');
      setCode('');
    } catch (e) {
      const first = Object.values(e.fields)[0];
      if (first) setFieldError(first);
      else if (path === 'handover' && e.status === 400) setFieldError(e.message); // wrong code, attempts left
      else setNotice({ kind: 'error', text: e.message });
      if (e.status === 423) load();
    } finally {
      setBusy(false);
    }
  };

  const blocked = claim.codeBlockedUntil && new Date(claim.codeBlockedUntil) > new Date();
  const finderSide = claim.isReviewer && !claim.isClaimant;

  return (
    <>
      <p><Link to={`/posts/${claim.postId}`}>← Back to the post</Link></p>
      <div className="card panel" style={{ maxWidth: 760 }}>
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
          <span className="badge found">Claim</span>
          <span className="badge status">{claimLabel(claim)}</span>
        </div>
        <h1>{claim.postTitle}</h1>
        <p className="hint">
          {claim.isClaimant ? 'Your claim' : `Claim by ${claim.claimantName || 'a former user'}`}, submitted {timeAgo(claim.createdAt)}
          {claim.finderName && claim.isClaimant ? ` · found by ${claim.finderName}` : ''}
        </p>
        {notice && <div className={`alert ${notice.kind}`} role="status">{notice.text}</div>}

        {claim.verificationQuestion && <p style={{ marginBottom: 0 }}><strong>Question:</strong> {claim.verificationQuestion}</p>}
        <div className="answers">
          <div>
            <span className="label">{claim.isClaimant ? 'Your answer' : "Claimant's answer"}</span>
            <span className="value">{claim.answer}</span>
          </div>
          {claim.expectedAnswer !== undefined && (
            <div className="expected">
              <span className="label">Expected answer</span>
              <span className="value">{claim.expectedAnswer}</span>
            </div>
          )}
        </div>
        {claim.description && <p style={{ whiteSpace: 'pre-wrap' }}><strong>Description:</strong> {claim.description}</p>}

        {/* Outcome */}
        {claim.status === 'REJECTED' && <div className="alert error"><strong>Rejected:</strong> {claim.rejectionReason}</div>}
        {claim.status === 'WITHDRAWN' && claim.cancelReason && <div className="alert warn"><strong>Handover cancelled:</strong> {claim.cancelReason}.  The post is open again.</div>}
        {claim.status === 'WITHDRAWN' && !claim.cancelReason && <div className="alert info">This claim was withdrawn.</div>}
        {claim.status === 'COMPLETED' && <div className="alert success"><strong>Item returned</strong> on {formatDate(claim.returnedAt, true)}.</div>}

        {/* Review (FR-6.8, FR-6.9) */}
        {claim.status === 'PENDING' && claim.isReviewer && mode !== 'reject' && (
          <div className="actions">
            <button type="button" className="btn green" disabled={busy}
              onClick={() => act('approve', {}, 'Claim approved.  The claimant can now see the handover code.')}>Approve</button>
            <button type="button" className="btn danger" onClick={() => setMode('reject')}>Reject</button>
          </div>
        )}
        {claim.status === 'PENDING' && claim.isClaimant && (
          <>
            <div className="alert info">The finder is reviewing your answer.  You will be notified of the decision.</div>
            <button type="button" className="btn secondary" disabled={busy} onClick={() => act('withdraw', {}, 'Your claim was withdrawn.')}>Withdraw claim</button>
          </>
        )}

        {/* Handover (FR-9.3 to FR-9.8) */}
        {claim.status === 'APPROVED' && claim.isClaimant && (
          <div>
            <p style={{ marginBottom: 0 }}><strong>Your handover code</strong></p>
            <div className="handover-code" aria-label={`Handover code ${claim.handoverCode?.split('').join(' ')}`}>{claim.handoverCode}</div>
            <p className="hint">Give this code to the finder or the security officer when you collect the item.  Only you can see it.</p>
          </div>
        )}
        {claim.status === 'APPROVED' && finderSide && (
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); act('handover', { code }, 'Item returned.  Thank you for helping!'); }} noValidate>
            <Field id="code" label="Confirm return: enter the owner's 4-digit code" error={fieldError}>
              <input id="code" inputMode="numeric" autoComplete="off" maxLength={4} value={code} disabled={blocked}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-invalid={!!fieldError} />
            </Field>
            <button type="submit" className="btn" disabled={busy || blocked || code.length !== 4} style={{ marginTop: '1.7rem' }}>Confirm return</button>
          </form>
        )}
        {claim.status === 'APPROVED' && blocked && (
          <div className="alert error" style={{ marginTop: '1rem' }}>Code entry is blocked until {formatDate(claim.codeBlockedUntil, true)} after five wrong codes.</div>
        )}
        {claim.status === 'APPROVED' && mode !== 'cancel' && (
          <div className="actions" style={{ marginTop: '1rem' }}>
            <button type="button" className="btn secondary" onClick={() => setMode('cancel')}>Cancel handover</button>
          </div>
        )}

        {/* Reason forms (FR-6.9, FR-9.10) */}
        {mode && (
          <form className="subpanel" noValidate onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'reject') act('reject', { reason }, 'Claim rejected.  The claimant was told why.');
            else act('cancel', { reason }, 'Handover cancelled.');
          }}>
            <Field id="reason" label={mode === 'reject' ? 'Why are you rejecting this claim?' : 'Why are you cancelling the handover?'} error={fieldError}>
              <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus aria-invalid={!!fieldError}
                placeholder={mode === 'reject' ? 'For example: the sticker is red, not blue' : 'For example: the owner did not come'} />
            </Field>
            <div className="actions">
              <button type="submit" className="btn danger" disabled={busy}>{mode === 'reject' ? 'Reject claim' : 'Cancel handover'}</button>
              <button type="button" className="btn secondary" onClick={() => { setMode(null); setFieldError(null); }}>Back</button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
