import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../api';
import { formatDate } from '../../format';

const POLL_MS = 3000; // FR-7.4: new messages appear within 5 seconds
const REASONS = [['SPAM', 'Spam'], ['FRAUD', 'Fraud'], ['INAPPROPRIATE', 'Inappropriate content'], ['PERSONAL_DATA', 'Exposed personal data'], ['OTHER', 'Other']];

/* FR-7.2 to FR-7.7: the private conversation of an approved claim. */
export default function Conversation() {
  const { id } = useParams();
  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [sendError, setSendError] = useState(null);
  const [reporting, setReporting] = useState(null);
  const [notice, setNotice] = useState(null);
  const lastId = useRef(0);
  const bottom = useRef(null);

  const append = (list) => {
    if (!list.length) return;
    lastId.current = list[list.length - 1].id;
    setMessages((m) => [...m, ...list.filter((x) => !m.some((y) => y.id === x.id))]);
  };

  const poll = useCallback(async () => {
    try {
      const { conversation } = await api.get(`/conversations/${id}?after=${lastId.current}`);
      setConv(conversation);
      append(conversation.messages);
    } catch (e) {
      if (!conv) setError(e);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    lastId.current = 0;
    setMessages([]);
    poll();
    const timer = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
    window.addEventListener('focus', poll); // catch up immediately after a reconnection
    return () => { clearInterval(timer); window.removeEventListener('focus', poll); };
  }, [poll]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  if (error) {
    return (
      <div className="card empty">
        <h3>{error.status === 403 ? 'Only the two participants can read this conversation' : error.status === 404 ? 'This conversation does not exist' : error.message}</h3>
        <Link to="/conversations">Back to your messages</Link>
      </div>
    );
  }
  if (!conv) return null;

  const send = async (e) => {
    e.preventDefault();
    setSendError(null);
    try {
      const { message } = await api.post(`/conversations/${id}/messages`, { body: text });
      append([message]);
      setText('');
    } catch (err) {
      setSendError(err.fields?.body || err.message);
      if (err.status === 409) poll();
    }
  };

  const report = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/messages/${reporting.id}/report`, { reason: reporting.reason, details: reporting.details });
      setNotice({ kind: 'success', text: 'Thank you.  The moderators will review this message.' });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
    setReporting(null);
  };

  const isParticipant = conv.participants.some((p) => p.isMe);
  const other = conv.participants.find((p) => !p.isMe) || conv.participants[1];

  return (
    <>
      <p><Link to="/conversations">← All messages</Link></p>
      <div className="card chat">
        <header className="chat-head">
          <div>
            <h1>{other.displayName} {other.badges.map((b) => <span key={b.code} className="badge award">🏅 {b.name}</span>)}</h1>
            <span className="sub">{other.role} · <Link to={`/posts/${conv.postId}`}>{conv.postTitle}</Link></span>
          </div>
          <Link to={`/claims/${conv.id}`} className="btn secondary small">Handover</Link>
        </header>
        {notice && <div className={`alert ${notice.kind}`} role="status" style={{ margin: '0.8rem 1rem 0' }}>{notice.text}</div>}
        <ol className="messages" aria-live="polite">
          {messages.length === 0 && <li className="hint empty-chat">No messages yet.  Agree on a time and place to hand over the item.</li>}
          {messages.map((m) => (
            <li key={m.id} className={m.mine ? 'mine' : 'theirs'}>
              <div className="bubble">{m.body}</div>
              <div className="meta">
                {formatDate(m.sentAt, true)}
                {!m.mine && isParticipant && (
                  <button type="button" className="link-button" onClick={() => setReporting({ id: m.id, reason: 'INAPPROPRIATE', details: '' })}>Report</button>
                )}
              </div>
            </li>
          ))}
          <li ref={bottom} aria-hidden="true" />
        </ol>
        {reporting && (
          <form className="report-form" onSubmit={report}>
            <label htmlFor="report-reason">Why are you reporting this message?</label>
            <select id="report-reason" value={reporting.reason} onChange={(e) => setReporting({ ...reporting, reason: e.target.value })}>
              {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input aria-label="Details (optional)" placeholder="Details (optional)" maxLength={500} value={reporting.details}
              onChange={(e) => setReporting({ ...reporting, details: e.target.value })} />
            <button type="submit" className="btn danger small">Report</button>
            <button type="button" className="btn secondary small" onClick={() => setReporting(null)}>Cancel</button>
          </form>
        )}
        {conv.canWrite ? (
          <form className="composer" onSubmit={send}>
            <label htmlFor="message" className="sr-only">Message</label>
            <textarea id="message" rows={2} maxLength={1000} value={text} placeholder="Write a message"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && text.trim()) send(e); }} />
            <div className="composer-side">
              <span className={`counter ${text.length > 950 ? 'warn' : ''}`}>{text.length}/1000</span>
              <button type="submit" className="btn" disabled={!text.trim()}>Send</button>
            </div>
            {sendError && <div className="field-error" role="alert">{sendError}</div>}
          </form>
        ) : (
          <div className="composer readonly">
            {conv.readOnly ? 'This conversation is read-only because the handover is over.  The history stays available.' : 'You are viewing this conversation to investigate a report.'}
          </div>
        )}
      </div>
    </>
  );
}
