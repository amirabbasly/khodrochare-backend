// A skipped job may complete while its database link is still PENDING, e.g. during
// source cooldown. BullMQ otherwise retains that ID and silently ignores re-adds.
async function enqueuePending(queue, name, data, options) {
  const old = await queue.getJob(options.jobId);
  if (old) {
    const state = await old.getState();
    if (!['completed', 'failed', 'unknown'].includes(state)) return;
    if (state !== 'unknown') await old.remove();
  }
  return queue.add(name, data, options);
}
module.exports = { enqueuePending };
