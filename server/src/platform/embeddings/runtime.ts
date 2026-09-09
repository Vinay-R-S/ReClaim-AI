/**
 * The ONNX runtime, configured once.
 *
 * Two things happen here that are easy to get wrong somewhere else and then
 * hard to find. The first is where model files live: the default cache sits
 * inside `node_modules`, which a reinstall deletes, so it is moved to a
 * directory the deployment owns. The second is thread count. ONNX Runtime
 * defaults to one thread per core, and in a container with a fractional CPU
 * allocation that is oversubscription: the threads spend their time contending
 * rather than working, and inference gets slower the more cores the host
 * reports. ADR 0004 calls this out as the usual cause of slow CPU inference,
 * so both counts are pinned.
 *
 * Loading is lazy and shared. A model is tens of megabytes and takes seconds
 * to load, so the first call pays for it, every later call does not, and a
 * burst of concurrent first calls loads once rather than once each.
 */

import path from 'node:path';
import { env as hfEnv } from '@huggingface/transformers';
import { env } from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('embeddings:runtime');

let configured = false;

/** Session options every model load shares. */
export function sessionOptions(): Record<string, unknown> {
  return {
    intraOpNumThreads: env.embeddings.threads,
    interOpNumThreads: 1,
  };
}

/**
 * Point the library at a cache the deployment controls, and pin the threads.
 *
 * Called by every loader rather than at import time, because importing this
 * module must not have side effects on a process that never embeds anything.
 */
export function configureRuntime(): void {
  if (configured) return;

  configured = true;

  const cacheDir = path.resolve(env.embeddings.cacheDir);

  hfEnv.cacheDir = cacheDir;
  hfEnv.allowLocalModels = true;
  // A deployment that has warmed its cache can refuse the network entirely,
  // which is what makes an air-gapped or offline start a configuration choice
  // rather than a hang on first request.
  hfEnv.allowRemoteModels = !env.embeddings.offline;

  // OpenMP reads this at first use, and ONNX Runtime's own count is set per
  // session below. Setting only one of the two leaves the other at the core
  // count, which is the oversubscription this is here to prevent.
  process.env.OMP_NUM_THREADS = String(env.embeddings.threads);

  log.info('Embedding runtime configured', {
    cacheDir,
    threads: env.embeddings.threads,
    offline: env.embeddings.offline,
  });
}

/**
 * One in-flight load per key.
 *
 * Not `singleFlight` from `utils/async`, because that clears the promise when
 * it settles and a loaded model is meant to be kept, not reloaded on the next
 * call.
 */
const loaded = new Map<string, Promise<unknown>>();

export function loadOnce<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = loaded.get(key);

  if (existing) return existing as Promise<T>;

  const started = Date.now();
  const loading = loader()
    .then((value) => {
      log.info('Model loaded', { model: key, ms: Date.now() - started });

      return value;
    })
    .catch((error: unknown) => {
      // A failed load must not be cached, or one network blip at startup
      // disables embeddings until the process restarts.
      loaded.delete(key);

      throw error;
    });

  loaded.set(key, loading);

  return loading;
}

/** Test seam, and what a model swap would need. */
export function resetRuntime(): void {
  loaded.clear();
  configured = false;
}
