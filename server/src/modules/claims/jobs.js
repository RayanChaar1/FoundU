const { closeReturnedPosts } = require('./service');

// FR-9.11: hourly, so a returned post closes within the hour after its 7 days
module.exports = [{ name: 'close-returned', everyMs: 60 * 60 * 1000, run: () => closeReturnedPosts() }];
