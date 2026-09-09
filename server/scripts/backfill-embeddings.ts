/**
 * Give every existing item a vector.
 *
 * New items are embedded by the `embed.item` job the outbox raises when they
 * are created or approved. Items that already existed when phase 22 shipped
 * raised no such event, so retrieval would see an empty corpus until each one
 * happened to be edited. This walks them once.
 *
 * It is the same work the job does, through the same service, so there is no
 * second implementation to keep in step. What this adds is paging, a rate at
 * which it is willing to run, and a dry run.
 *
 * Usage, from the `server` directory with a populated `.env`:
 *
 *   npm run backfill:embeddings            # dry run, counts the work, writes nothing
 *   npm run backfill:embeddings -- --apply # embeds and writes
 *
 * Safe to run more than once and safe to interrupt. An item whose stored
 * content hash already matches its text is skipped, so a second run reports
 * nothing to do and a resumed run picks up where it stopped.
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// Imported after dotenv, because the config module parses process.env on import.
const { itemRepository } = await import('../src/repositories/item.repository.js');
const { embeddingService, composeItemText } = await import('../src/services/embedding.service.js');
const { contentKey } = await import('../src/platform/embeddings/embedding.cache.js');
const { isFetchableImageUrl } = await import('../src/platform/embeddings/image.source.js');
const { textModel } = await import('../src/platform/embeddings/models.js');

const PAGE_SIZE = 100;

interface Progress {
  scanned: number;
  embedded: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

type Verdict = 'work' | 'unchanged' | 'skipped';

/**
 * What the dry run reports, applying the same tests the service does.
 *
 * Only used when nothing is being written: in `--apply` the service is called
 * directly and its own outcome is the answer, so an item is read once rather
 * than once here and again inside the service.
 */
async function verdictFor(itemId: string): Promise<Verdict> {
  const item = await itemRepository.findByIdWithVectors(itemId);

  if (!item) return 'skipped';

  const content = composeItemText(item);

  if (!content) return 'skipped';

  const spec = textModel();
  const stale = item.embeddingKey !== contentKey(spec.id, spec.revision, content);
  const owesImage = !item.imageEmbedding && (item.cloudinaryUrls ?? []).some(isFetchableImageUrl);

  return stale || owesImage ? 'work' : 'unchanged';
}

async function run(apply: boolean): Promise<Progress> {
  const progress: Progress = { scanned: 0, embedded: 0, unchanged: 0, skipped: 0, failed: 0 };
  let cursor: string | undefined;

  for (;;) {
    const page = await itemRepository.pageForEmbedding(PAGE_SIZE, cursor);

    if (page.length === 0) break;

    for (const row of page) {
      progress.scanned += 1;

      if (!apply) {
        const verdict = await verdictFor(row.id);

        if (verdict === 'work') {
          progress.embedded += 1;
          console.log(`${row.id}  -> would embed`);
        } else if (verdict === 'unchanged') {
          progress.unchanged += 1;
        } else {
          // An item with no embeddable text is reported as skipped rather than
          // counted as done, so the summary says what the run could not handle.
          progress.skipped += 1;
        }

        continue;
      }

      try {
        // One at a time on purpose. This is a background chore competing with
        // a live API for the same pinned threads, and finishing an hour later
        // is cheaper than making every request slower while it runs.
        const outcome = await embeddingService.embedItem(row.id);

        if (outcome === 'embedded') progress.embedded += 1;
        else if (outcome === 'unchanged') progress.unchanged += 1;
        else progress.skipped += 1;

        if (progress.scanned % 25 === 0) {
          console.log(`  ...${progress.scanned} scanned, ${progress.embedded} embedded`);
        }
      } catch (error) {
        progress.failed += 1;
        console.error(`${row.id}  FAILED`, error instanceof Error ? error.message : error);
      }
    }

    cursor = page[page.length - 1].id;

    if (page.length < PAGE_SIZE) break;
  }

  return progress;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  if (!embeddingService.isEnabled()) {
    console.error('EMBEDDINGS_ENABLED is false, so there is nothing this can do.');
    process.exit(1);
  }

  if (!apply) {
    console.log('DRY RUN. Nothing will be written. Re-run with --apply to commit.\n');
  } else {
    console.log('Embedding. The first item pays for the model load.\n');
  }

  const progress = await run(apply);

  console.log('');
  console.log(`Scanned:   ${progress.scanned}`);
  console.log(`${apply ? 'Embedded:' : 'To embed:'}  ${progress.embedded}`);
  console.log(`Unchanged: ${progress.unchanged}`);
  console.log(`Skipped:   ${progress.skipped}`);
  console.log(`Failed:    ${progress.failed}`);

  process.exit(progress.failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error('Backfill failed', error);
  process.exit(1);
});
