const EventEmitter = require('events');

const jobs = new Map();

// Auto-cleanup jobs older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}, 30 * 60 * 1000);

function create(id, data) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  jobs.set(id, { ...data, emitter, events: [], createdAt: Date.now() });
}

function get(id) {
  return jobs.get(id) || null;
}

function update(id, patch) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.set(id, { ...job, ...patch });
}

function emit(id, event) {
  const job = jobs.get(id);
  if (!job) return;
  job.events.push(event);
  job.emitter.emit('event', event);
}

function remove(id) {
  jobs.delete(id);
}

module.exports = { create, get, update, emit, remove };
