/**
 * Process lifecycle: validate configuration, build the app, open the port.
 *
 * Imported dynamically by `index.ts` after `dotenv` has run, because `env.ts`
 * parses `process.env` at import time.
 */

import { env } from './config/env.js';
import { createApp } from './app.js';
import { createLogger } from './utils/logger.js';
import { closeJobQueue, getJobQueue } from './platform/jobs/queue.js';
import { closeSharedRedis } from './platform/redis/shared.js';
import { DEFAULT_DRAINER_OPTIONS, OutboxDrainer } from './platform/outbox/outbox.drainer.js';

const log = createLogger('server');

env.warnings.forEach((warning) => log.warn(`Configuration warning: ${warning}`));

const app = createApp();

const server = app.listen(env.port, () => {
  log.info('ReClaim AI server listening', {
    url: `http://localhost:${env.port}`,
    environment: env.nodeEnv,
  });
});

/**
 * With Redis configured the worker process owns the outbox, and the API only
 * writes to it. Without Redis there is no worker, so the API drains its own
 * outbox: the events still commit atomically with the state change, and the
 * work still runs, it just runs here and does not survive a restart.
 */
const drainer = env.queue.isConfigured
  ? null
  : new OutboxDrainer(getJobQueue(), undefined, {
      ...DEFAULT_DRAINER_OPTIONS,
      pollIntervalMs: env.queue.outboxPollIntervalMs,
      batchSize: env.queue.outboxBatchSize,
    });

drainer?.start();

/**
 * How long a shutdown waits for background work before leaving it.
 *
 * The in-process driver's worst case is three attempts of two minutes each,
 * and a container that has not exited well before that is killed anyway. The
 * outbox is what makes leaving safe: a committed event is drained by whoever
 * starts next.
 */
const SHUTDOWN_GRACE_MS = 10_000;

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;

  shuttingDown = true;
  log.info(`Shutting down on ${signal}`);

  server.close();

  const finished = (async () => {
    await drainer?.stop();
    // The in-process driver finishes what it is running, so a job that started
    // is not abandoned halfway through a deploy.
    await closeJobQueue();
    // The AI cache and rate budget hold this one when Redis is configured.
    await closeSharedRedis();
  })();

  await Promise.race([
    finished,
    new Promise((resolve) => {
      setTimeout(resolve, SHUTDOWN_GRACE_MS).unref();
    }),
  ]);

  process.exit(0);
}

/** A failure to shut down cleanly must still shut down. */
function onSignal(signal: string): void {
  shutdown(signal).catch((error: unknown) => {
    log.error('Shutdown failed', { error });
    process.exit(1);
  });
}

process.on('SIGTERM', () => onSignal('SIGTERM'));
process.on('SIGINT', () => onSignal('SIGINT'));

export { app, server, drainer };
