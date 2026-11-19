const path = require('path');

const env = process.env;

function required(name, fallback) {
  const value = env[name] || fallback;
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const isTest = env.NODE_ENV === 'test';

module.exports = {
  isTest,
  port: Number(env.PORT || 4000),
  databaseUrl: required('DATABASE_URL', isTest ? 'postgres://postgres@localhost:5432/foundu_test' : undefined),
  jwtSecret: required('JWT_SECRET', isTest ? 'test-secret' : undefined),
  // 32-byte key (64 hex characters) for AES-256-GCM encryption of verification answers (NFR-10.1)
  dataKey: required('DATA_KEY', isTest ? 'a'.repeat(64) : undefined),
  clientUrl: env.CLIENT_URL || 'http://localhost:5173',
  // NFR-11.2: requests per minute per user; the tests raise it, except the one that checks it
  rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE || (isTest ? 10000 : 100)),
  // NFR-1: requests handled at the same time; beyond that, 503 "try again" (the tests raise it, except the one that checks it)
  maxInFlight: Number(env.MAX_IN_FLIGHT || (isTest ? 10000 : 500)),
  // NFR-9: HTTPS when both files are given (otherwise HTTP, for the local demo)
  tlsCert: env.TLS_CERT,
  tlsKey: env.TLS_KEY,
  sessionMinutes: 30, // FR-1.9: sign out after 30 minutes of inactivity
  otpMinutes: 10, // FR-1.4
  uploadDir: isTest
    ? path.join(require('os').tmpdir(), 'foundu-test-uploads')
    : path.resolve(__dirname, '..', env.UPLOAD_DIR || 'uploads'),
  outboxDir: path.resolve(__dirname, '..', 'outbox'),
  smtp: {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM || 'FoundU <no-reply@foundu.app>',
  },
};
