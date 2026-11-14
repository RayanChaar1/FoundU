/* In-process domain events, so modules react to each other without direct dependencies (5.3).
   Example: Posts emits 'post.published'; Smart Match listens to it (FR-2.9). */
const { EventEmitter } = require('events');

const bus = new EventEmitter();
const pending = new Set();

/** Emits an event; listeners run asynchronously and their errors are logged, never thrown to the caller. */
function emit(name, payload) {
  for (const listener of bus.listeners(name)) {
    const run = Promise.resolve()
      .then(() => listener(payload))
      .catch((err) => console.error(`[event ${name}]`, err))
      .finally(() => pending.delete(run));
    pending.add(run);
  }
}

const on = (name, listener) => bus.on(name, listener);

/** Waits until every running listener has finished (used by tests). */
async function settle() {
  while (pending.size) await Promise.all([...pending]);
}

module.exports = { emit, on, settle };
