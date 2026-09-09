/**
 * Download the embedding models into the cache before anything needs them.
 *
 * Model files are fetched on first use, which is right for a developer and
 * wrong for a container: the first request after a deploy would otherwise wait
 * on a download, and a deployment with no egress would fail at the worst
 * possible moment rather than at build time. Run this in the image build, and
 * set EMBEDDINGS_OFFLINE=true at runtime once it has.
 *
 *   npm run warm-models
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const { textEmbedder } = await import('../src/platform/embeddings/text.embedder.js');
const { imageEmbedder } = await import('../src/platform/embeddings/image.embedder.js');

async function main(): Promise<void> {
  console.log('Warming the text encoder...');

  const started = Date.now();
  const [vector] = await textEmbedder.embed(['a black leather wallet found near the library']);

  console.log(`  ${textEmbedder.id}: ${vector.length} dimensions in ${Date.now() - started}ms`);

  console.log('Warming the image encoder...');

  // A 1x1 PNG: enough to force the processor and the session to load, without
  // shipping a fixture image to do it.
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  const imageStarted = Date.now();
  const [imageVector] = await imageEmbedder.embedImage([pixel]);

  console.log(
    `  ${imageEmbedder.id}: ${imageVector.length} dimensions in ${Date.now() - imageStarted}ms`,
  );

  console.log('\nModels cached. Set EMBEDDINGS_OFFLINE=true to refuse the network at runtime.');
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('Warm-up failed', error);
  process.exit(1);
});
