const config = require('./config');
const { createApp } = require('./app');

createApp().listen(config.port, () => {
  console.log(`FoundU API listening on http://localhost:${config.port}`);
});
