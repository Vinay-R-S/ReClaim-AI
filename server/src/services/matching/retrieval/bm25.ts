/**
 * Lexical retrieval, BM25 over the filtered candidate set.
 *
 * Dense vectors and lexical search fail in opposite directions, which is why
 * section 8.2 fuses them rather than choosing. An embedding handles "Apple
 * phone" against "iPhone 13" and blurs a serial number into every other serial
 * number; BM25 finds the serial number, the name written inside a bag, or a
 * model string exactly, and has nothing to say about a synonym. Lost-and-found
 * text is short and full of proper nouns, so the lexical half earns its place.
 *
 * Built per run over the candidates that survived the filter stage, not
 * maintained as an index. At a few hundred short documents that is a
 * millisecond of work, and it avoids a second store to keep in step with the
 * items collection.
 */

/** Standard BM25 constants: term saturation, and length normalisation. */
const K1 = 1.5;
const B = 0.75;

/**
 * Words carrying no discriminating power in this corpus.
 *
 * Deliberately short. An aggressive stop list would strip "black" out of
 * "black wallet", and colour is one of the few attributes a reporter reliably
 * gets right.
 */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'my',
  'is',
  'it',
  'this',
  'that',
  'i',
  'was',
  'near',
  'lost',
  'found',
  'item',
]);

export function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      // Keep digits joined to letters: a model number is one token, not two.
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
  );
}

interface Document {
  id: string;
  tokens: string[];
  length: number;
}

export interface LexicalHit {
  id: string;
  score: number;
}

export class Bm25Index {
  private readonly documents: Document[] = [];

  private readonly frequency = new Map<string, number>();

  private averageLength = 0;

  constructor(entries: Array<{ id: string; text: string }>) {
    entries.forEach(({ id, text }) => {
      const tokens = tokenize(text);

      this.documents.push({ id, tokens, length: tokens.length });

      new Set(tokens).forEach((token) => {
        this.frequency.set(token, (this.frequency.get(token) ?? 0) + 1);
      });
    });

    const total = this.documents.reduce((sum, document) => sum + document.length, 0);

    this.averageLength = this.documents.length > 0 ? total / this.documents.length : 0;
  }

  get size(): number {
    return this.documents.length;
  }

  /**
   * Inverse document frequency, in the form that cannot go negative.
   *
   * The textbook BM25 IDF is negative for a term in more than half the
   * documents, which for a corpus where nearly every report says "phone" would
   * subtract score for matching the very word the search is about. The `+1`
   * variant keeps it monotonic.
   */
  private idf(term: string): number {
    const containing = this.frequency.get(term) ?? 0;

    if (containing === 0) return 0;

    return Math.log(1 + (this.documents.length - containing + 0.5) / (containing + 0.5));
  }

  search(query: string, k: number): LexicalHit[] {
    if (this.documents.length === 0) return [];

    const terms = tokenize(query);

    if (terms.length === 0) return [];

    const scored = this.documents.map((document) => {
      const counts = new Map<string, number>();

      document.tokens.forEach((token) => counts.set(token, (counts.get(token) ?? 0) + 1));

      const score = terms.reduce((total, term) => {
        const occurrences = counts.get(term) ?? 0;

        if (occurrences === 0) return total;

        const normalised = this.averageLength > 0 ? document.length / this.averageLength : 1;
        const denominator = occurrences + K1 * (1 - B + B * normalised);

        return total + this.idf(term) * ((occurrences * (K1 + 1)) / denominator);
      }, 0);

      return { id: document.id, score };
    });

    return scored
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
