const fs = require('fs');
const https = require('https');
const config = require('./config');
const { createApp } = require('./app');
const { startJobs } = require('./jobs');

const app = createApp();
const started = (scheme) => () => {
  console.log(`FoundU API listening on ${scheme}://localhost:${config.port}`);
  startJobs();
};

if (config.tlsCert && config.tlsKey) {
  // NFR-9: TLS 1.2 or later only; older versions are refused during the handshake
  const options = { cert: fs.readFileSync(config.tlsCert), key: fs.readFileSync(config.tlsKey), minVersion: 'TLSv1.2' };
  https.createServer(options, app).listen(config.port, started('https'));
} else {
  app.listen(config.port, started('http'));
}
