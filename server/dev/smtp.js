/* A small SMTP server that plays the part of an organization's mail server during development (NFR-25.2):
   STARTTLS (RFC 3207) with a self-signed certificate made at start-up, then AUTH PLAIN or LOGIN (RFC 4954).
   It accepts the user "foundu" with the password "dev-smtp-pass", answers 535 to any other credentials, and
   prints each delivered email instead of sending it on.  Development only.
   Start:  npm run smtp --workspace server   (port 2587; the README gives the settings for the API) */
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const port = Number(process.env.SMTP_DEV_PORT || 2587);
const USER = 'foundu';
const PASS = 'dev-smtp-pass';
const dir = path.join(os.tmpdir(), 'foundu-dev-smtp');
fs.mkdirSync(dir, { recursive: true });
const key = path.join(dir, 'key.pem');
const cert = path.join(dir, 'cert.pem');
if (!fs.existsSync(cert)) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '365',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
}
const ctx = tls.createSecureContext({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) });
const log = (obj) => console.log(JSON.stringify({ at: new Date().toISOString(), ...obj }));

net.createServer((raw) => {
  let sock = raw;
  let secure = false;
  let authed = false;
  let mail = null;
  let data = null;
  let buf = '';
  let authStep = null;
  let authUser = null;
  const send = (line) => sock.write(line + '\r\n');
  const check = (user, pass) => {
    const ok = secure && user === USER && pass === PASS;
    log({ event: ok ? 'login accepted' : 'login refused (535)', user });
    if (ok) { authed = true; send('235 2.7.0 Authentication successful'); } else send('535 5.7.8 Authentication credentials invalid');
  };
  const onLine = (line) => {
    if (data !== null) {
      if (line === '.') {
        log({ event: 'email delivered', ...mail, tls: secure, size: data.length, subject: (data.match(/^Subject: (.*)$/mi) || [])[1] });
        data = null; mail = null;
        return send('250 2.0.0 Queued');
      }
      data += (line.startsWith('..') ? line.slice(1) : line) + '\n';
      return undefined;
    }
    if (authStep === 'user') { authUser = Buffer.from(line, 'base64').toString(); authStep = 'pass'; return send('334 UGFzc3dvcmQ6'); }
    if (authStep === 'pass') { authStep = null; return check(authUser, Buffer.from(line, 'base64').toString()); }
    const [cmd, ...rest] = line.split(' ');
    const arg = rest.join(' ');
    switch (cmd.toUpperCase()) {
      case 'EHLO': case 'HELO':
        send('250-localhost');
        if (!secure) send('250-STARTTLS');
        else send('250-AUTH PLAIN LOGIN');
        return send('250 8BITMIME');
      case 'STARTTLS':
        send('220 2.0.0 Ready to start TLS');
        sock.removeAllListeners('data');
        sock = new tls.TLSSocket(raw, { isServer: true, secureContext: ctx });
        sock.on('secure', () => { secure = true; log({ event: 'TLS started', protocol: sock.getProtocol() }); });
        sock.on('data', onData);
        sock.on('error', () => {});
        return undefined;
      case 'AUTH': {
        const [mech, initial] = arg.split(' ');
        if (!secure) return send('538 5.7.11 Encryption required');
        if (mech.toUpperCase() === 'PLAIN') {
          const [, user, pass] = Buffer.from(initial || '', 'base64').toString().split('\0');
          return check(user, pass);
        }
        if (mech.toUpperCase() === 'LOGIN') { authStep = 'user'; return send('334 VXNlcm5hbWU6'); }
        return send('504 5.5.4 Unrecognized authentication type');
      }
      case 'MAIL':
        if (!authed) return send('530 5.7.0 Authentication required');
        mail = { from: arg.replace(/^FROM:/i, ''), to: [] };
        return send('250 2.1.0 OK');
      case 'RCPT': mail.to.push(arg.replace(/^TO:/i, '')); return send('250 2.1.5 OK');
      case 'DATA': data = ''; return send('354 End data with <CR><LF>.<CR><LF>');
      case 'RSET': mail = null; return send('250 2.0.0 OK');
      case 'NOOP': return send('250 2.0.0 OK');
      case 'QUIT': send('221 2.0.0 Bye'); return sock.end();
      default: return send('502 5.5.2 Command not recognized');
    }
  };
  function onData(chunk) {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); onLine(line); }
  }
  raw.on('data', onData);
  raw.on('error', () => {});
  send('220 localhost ESMTP FoundU test server');
}).listen(port, '127.0.0.1', () => {
  console.log(`Development SMTP server on localhost:${port} (user ${USER}, password ${PASS})`);
  console.log(`Start the API with NODE_EXTRA_CA_CERTS=${cert} so that it trusts this server's certificate.`);
});
