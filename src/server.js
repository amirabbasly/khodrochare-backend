const http = require('node:http');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');
const { Queue, Worker } = require('bullmq');
const { Server } = require('socket.io');
const config = require('./config');
const { createServices } = require('./services');
const { createApp } = require('./app');
const { attachRealtime } = require('./realtime');
const prisma = new PrismaClient();
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
const jobsRedis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
for (const client of [redis, jobsRedis]) client.on('error', err => console.error('Redis:', err.message));
let app;
const server = http.createServer((req, res) => app(req, res));
const io = new Server(server, { cors: { origin: config.origins }, maxHttpBufferSize: 16384, allowRequest: (req, done) => done(null, !req.headers.origin || config.origins.includes(req.headers.origin)) });
const services = createServices({ prisma, redis, config, io });
app = createApp({ prisma, redis, config, io, services });

attachRealtime(io, services, redis);

// Durable database outbox bridges PostgreSQL commits and Redis without losing jobs.
const queue = new Queue('request-events', { connection: jobsRedis });
const worker = new Worker('request-events', async job => {
  const event = await prisma.outbox.findUnique({ where: { id: job.data.eventId } });
  if (!event) return;
  const request = await prisma.assistanceRequest.findUnique({ where: { id: event.requestId } });
  if (!request) return;
  io.to(`user:${request.customerId}`).emit('request:updated', request);
  if (request.driverId) io.to(`user:${request.driverId}`).emit('request:updated', request);
  // Clients use the authorized available-request endpoint to retrieve matching jobs.
  await prisma.outbox.update({ where: { id: event.id }, data: { publishedAt: new Date() } });
}, { connection: jobsRedis, concurrency: 5 });
worker.on('failed', (job, err) => console.error('Background event failed:', job?.id, err.message));
worker.on('error', err => console.error('Worker:', err.message));
let dispatching = false;
async function dispatch() {
  if (dispatching) return;
  dispatching = true;
  try {
    const pending = await prisma.outbox.findMany({ where: { publishedAt: null }, orderBy: { createdAt: 'asc' }, take: 100 });
    for (const event of pending) await queue.add('changed', { eventId: event.id }, { jobId: event.id, attempts: 10, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true, removeOnFail: { age: 86400 } });
  } catch (e) { console.error('Outbox:', e.message); }
  finally { dispatching = false; }
}
let timer;
async function start() {
  await prisma.$connect();
  await redis.ping();
  timer = setInterval(dispatch, 2000);
  server.listen(config.PORT, '0.0.0.0', () => console.log(`API listening on ${config.PORT}`));
}
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  const timeout = setTimeout(() => process.exit(1), 25000).unref();
  await new Promise(resolve => io.close(resolve));
  await worker.close();
  await queue.close();
  await Promise.all([redis.quit(), jobsRedis.quit(), prisma.$disconnect()]);
  clearTimeout(timeout);
}
process.on('SIGTERM', () => stop().catch(console.error));
process.on('SIGINT', () => stop().catch(console.error));
start().catch(async e => { console.error(e.message); await stop(); process.exitCode = 1; });
