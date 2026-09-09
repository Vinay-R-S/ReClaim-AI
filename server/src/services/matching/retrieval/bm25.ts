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
 * How much more an identifier term counts than an ordinary word.
 *
 * Tuned on the labelled set: at 1 the model-number case ranks second, and
 * above about 4 nothing further improves because the identifier already
 * dominates any document containing it.
 */
const IDENTIFIER_BOOST = 3;

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

/**
 * An identifier: a serial number, a model number, an IMEI, a registration.
 *
 * In lost property these are the most discriminating thing a report can
 * contain — two people describing the same object agree on almost nothing
 * except the number printed on it — which is why they are weighted and
 * promoted. That makes a false positive expensive: a token wrongly called an
 * identifier hoists every candidate sharing it above the ranked order.
 *
 * "Contains a letter and a digit" was too weak, and matched exactly the words
 * a phone report is full of: `128gb`, `1080p`, `usb3`, `wd40`, `5000mah`,
 * `iphone13`. Every one of those is a specification shared by thousands of
 * objects, and each was being treated as conclusive.
 *
 * What separates them is shape. A capacity or a resolution is one run of
 * digits and one run of letters — a single transition. A real identifier
 * interleaves them at least twice (`ch720n`, `7xkq2m3`), or is a long bare
 * number (an IMEI, a serial).
 */
function isIdentifier(token: string): boolean {
  if (token.length < 4) return false;

  if (/^\d{5,}$/.test(token)) return true;

  // Count the boundaries between a letter run and a digit run.
  const transitions = (token.match(/(?:[a-z]\d)|(?:\d[a-z])/g) ?? []).length;

  return transitions >= 2;
}

/**
 * Split text into terms.
 *
 * Hyphens and full stops inside an alphanumeric run are kept as well as split,
 * because `WH-CH720N` is one identifier and also two fragments, and which one
 * the other report wrote it as is not knowable. Splitting only, which is what
 * this did, destroyed the exact token in the one case lexical retrieval exists
 * to win: the model number ranked second behind a candidate that merely shared
 * the words "headphones" and "black".
 *
 * The joined form is only kept when it looks like an identifier, so ordinary
 * hyphenation ("over-ear") does not double every token it appears in.
 */
export function tokenize(text: string): string[] {
  const lowered = text.toLowerCase();
  const tokens: string[] = [];

  // Runs of letters, digits and the separators that appear inside part
  // numbers. Anything else is a boundary.
  const runs = lowered.match(/[a-z0-9]+(?:[-.][a-z0-9]+)*/g) ?? [];

  runs.forEach((run) => {
    const joined = run.replace(/[-.]/g, '');
    // Deduped within the run only. Deduping across the whole text would make
    // every term frequency 1 and quietly turn BM25 into set overlap, which is
    // a different algorithm with the saturation and length normalisation
    // switched off.
    const fromRun = new Set<string>();

    if (isIdentifier(joined)) {
      // Both spellings, so a report writing `WH-CH720N` matches one writing
      // `WHCH720N`, and the parts still match on their own.
      fromRun.add(run);
      fromRun.add(joined);
    }

    run.split(/[-.]+/).forEach((part) => fromRun.add(part));

    fromRun.forEach((token) => tokens.push(token));
  });

  return tokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export { isIdentifier };

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
        // IDF already rewards a rare term, but not enough to beat a candidate
        // that shares half a dozen ordinary words. Two reports agreeing on a
        // serial number are describing the same object; two reports agreeing
        // on "black" and "headphones" are describing a category.
        const weight = isIdentifier(term) ? IDENTIFIER_BOOST : 1;

        return total + weight * this.idf(term) * ((occurrences * (K1 + 1)) / denominator);
      }, 0);

      return { id: document.id, score };
    });

    return scored
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
