/**
 * Run the evaluation harness and print the report.
 *
 * The retrieval half runs anywhere. The rerank half needs a provider, so it is
 * opt-in with `--rerank`: it makes real model calls and costs real money, and
 * a script that quietly spends is a script nobody runs twice.
 *
 *   npm run eval             # lexical retrieval only, no model at all
 *   npm run eval -- --dense  # adds the dense retriever, needs the local weights
 *   npm run eval -- --rerank # adds the reranker, one hosted call per case
 *   npm run eval -- --json   # the report as JSON, for a run manifest
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const { runEval, formatReport } = await import('../src/eval/runner.js');

async function main(): Promise<void> {
  const wantsRerank = process.argv.includes('--rerank');
  const dense = process.argv.includes('--dense');
  const asJson = process.argv.includes('--json');

  let reranker = null;

  if (wantsRerank) {
    const { providerRegistry } = await import('../src/platform/ai/index.js');

    if (providerRegistry.available().length === 0) {
      console.error('--rerank needs an AI provider key. See server/.env.example.');
      process.exit(1);
    }

    ({ llmReranker: reranker } =
      (await import('../src/services/matching/rerank/llm.reranker.js')) as unknown as {
        llmReranker: null;
      });
  }

  const report = await runEval({ reranker, dense });

  console.log(asJson ? JSON.stringify(report, null, 2) : formatReport(report));
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('Eval failed', error);
  process.exit(1);
});
