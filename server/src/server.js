const config = require('./config');
const { createApp } = require('./app');
const { startJobs } = require('./jobs');

createApp().listen(config.port, () => {
  console.log(`FoundU API listening on http://localhost:${config.port}`);
  startJobs();
});
