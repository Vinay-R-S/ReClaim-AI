/**
 * The Redis connection.
 *
 * One place that knows the options BullMQ requires (`maxRetriesPerRequest` must
 * be null, or a worker blocking on a queue read is killed by the client) and
 * one place that logs a connection problem, so a queue outage reads as itself
 * rather than as a job that never ran.
 */

import { Redis } from 'ioredis';
import { createLogger } from '../../utils/logger.js';
import { trackReady } from '../redis/ready.js';

const log = createLogger('redis');

export function createRedisConnection(url: string, role: 'producer' | 'consumer'): Redis {
  const connection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    // A queue outage must degrade the caller, never stall it. A producer
    // command issued while Redis is down fails immediately, so an enqueue
    // awaited inside a request or a drain pass cannot hang forever waiting for
    // a client-side buffer to flush. A consumer keeps the buffer, because
    // BullMQ's blocking reads have to survive a reconnect rather than reject.
    //
    // The one moment that is not an outage is the opening handshake, which is
    // what `redis/ready.ts` exists for. BullMQ awaits its own `waitUntilReady`
    // before every command, so the queue itself does not need the gate; code
    // holding this connection and issuing a raw command does.
    enableOfflineQueue: role === 'consumer',
    connectionName: `reclaim-${role}`,
  });

  // Watched from creation, so the gate knows whether this connection has ever
  // opened rather than only whether it is open right now.
  trackReady(connection);

  connection.on('error', (error: unknown) => log.error('Redis connection error', { role, error }));
  connection.on('end', () => log.warn('Redis connection closed', { role }));

  return connection;
}
