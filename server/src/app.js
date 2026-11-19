/* Interface layer (Figure 6): the Express REST API. */
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { loadUser } = require('./middleware/auth');
const { errorHandler } = require('./middleware/error');

const MODULES = path.join(__dirname, 'modules');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(helmet());

  // NFR-1: when the server is overloaded, extra requests get 503 at once instead of waiting in a queue
  const { maxInFlight } = config;
  let inFlight = 0;
  app.use('/api', (req, res, next) => {
    if (inFlight >= maxInFlight) {
      res.set('Retry-After', '5');
      return res.status(503).json({ error: 'FoundU is very busy.  Try again in a few seconds.' });
    }
    inFlight += 1;
    res.once('close', () => { inFlight -= 1; });
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(loadUser);

  // NFR-11.2: at most 100 requests per minute per user (or per address when signed out)
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: config.rateLimitPerMinute,
      keyGenerator: (req) => (req.user ? `u${req.user.user_id}` : rateLimit.ipKeyGenerator(req.ip)),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests.  Try again in a minute.' },
    }),
  );

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  // Every module folder with a routes.js is mounted automatically, so a new module only adds files
  for (const name of fs.readdirSync(MODULES).sort()) {
    const routes = path.join(MODULES, name, 'routes.js');
    if (fs.existsSync(routes)) app.use('/api', require(routes));
  }

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
