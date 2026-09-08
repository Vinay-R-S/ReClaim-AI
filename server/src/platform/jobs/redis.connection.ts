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
    enableOfflineQueue: role === 'consumer',
    connectionName: `reclaim-${role}`,
  });

  connection.on('error', (error: unknown) => log.error('Redis connection error', { role, error }));
  connection.on('end', () => log.warn('Redis connection closed', { role }));

  return connection;
}
