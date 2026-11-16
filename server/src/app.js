/* Interface layer (Figure 6): the Express REST API. */
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { loadUser } = require('./middleware/auth');
const { errorHandler } = require('./middleware/error');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(loadUser);

  // NFR-11.2: at most 100 requests per minute per user (or per address when signed out)
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: config.isTest ? 10000 : 100,
      keyGenerator: (req) => (req.user ? `u${req.user.user_id}` : rateLimit.ipKeyGenerator(req.ip)),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests.  Try again in a minute.' },
    }),
  );

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api', require('./modules/accounts/routes'));
  app.use('/api', require('./modules/reference/routes'));
  app.use('/api', require('./modules/posts/routes'));
  app.use('/api', require('./modules/search/routes'));
  app.use('/api', require('./modules/claims/routes'));
  app.use('/api', require('./modules/matching/routes'));
  app.use('/api', require('./modules/notifications/routes'));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
