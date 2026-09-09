/**
 * The lexical half of retrieval.
 *
 * It exists for the cases an embedding blurs: a serial number, a model string,
 * a name written inside a bag. So what is worth pinning is that an exact rare
 * token wins, that a common one does not, and that the IDF cannot go negative
 * and start subtracting score for matching the very word the search is about.
 */

import { describe, expect, it } from 'vitest';
import { Bm25Index, isIdentifier, tokenize } from './bm25.js';

const CORPUS = [
  { id: 'wallet', text: 'Black leather wallet with cards inside' },
  { id: 'phone', text: 'iPhone 13 black, cracked screen, IMEI 356938035643809' },
  { id: 'bag', text: 'Blue Nike sports bag with a water bottle' },
  { id: 'keys', text: 'Bunch of keys with a red keyring' },
  { id: 'phone2', text: 'Samsung phone, black case, no marks' },
];

function index() {
  return new Bm25Index(CORPUS);
}

describe('isIdentifier', () => {
  it.each(['wh-ch720n', 'whch720n', '7xkq2m3', '356938035643809'])('recognises %s', (token) => {
    expect(isIdentifier(token)).toBe(true);
  });

  it.each(['wallet', 'black', 'nike', 'a1', '13'])('does not claim %s is one', (token) => {
    expect(isIdentifier(token)).toBe(false);
  });

  /**
   * The false positives that matter, because an identifier is both weighted
   * and promoted: a token wrongly called one hoists every candidate sharing it
   * above the ranked order. "Contains a letter and a digit" matched exactly
   * the words a phone report is full of, every one of them a specification
   * shared by thousands of objects.
   *
   * What separates them is shape. A capacity or a resolution is one run of
   * digits and one of letters; a real identifier interleaves them twice.
   */
  it.each(['128gb', '1080p', 'usb3', 'wd40', '5000mah', 'iphone13', '4k'])(
    'does not treat the specification %s as an identifier',
    (token) => {
      expect(isIdentifier(token)).toBe(false);
    },
  );
});

describe('tokenize', () => {
  it('keeps digits joined to letters, so a model number stays one token', () => {
    expect(tokenize('iPhone 13 IMEI 356938035643809')).toContain('356938035643809');
  });

  /**
   * The regression this exists for. Splitting on the hyphen destroyed the
   * exact identifier in the one case lexical retrieval is supposed to win: the
   * model number ranked second, behind a candidate that merely repeated the
   * words "headphones" and "black".
   */
  it('keeps a hyphenated model number whole, as well as split', () => {
    const tokens = tokenize('model WH-CH720N');

    expect(tokens).toContain('wh-ch720n');
    expect(tokens).toContain('whch720n');
    expect(tokens).toContain('ch720n');
  });

  it('does not double ordinary hyphenated words', () => {
    const tokens = tokenize('over-ear headphones');

    expect(tokens).not.toContain('overear');
    expect(tokens).toEqual(['over', 'ear', 'headphones']);
  });

  /**
   * Term frequency is half of what BM25 is. An earlier version deduped across
   * the whole text, which silently turned it into set overlap with the
   * saturation and length normalisation switched off.
   */
  it('keeps repeated words repeated', () => {
    expect(tokenize('black bag black shoes')).toEqual(['black', 'bag', 'black', 'shoes']);
  });

  it('drops single characters and the words every report uses', () => {
    expect(tokenize('I lost a black wallet in the park')).toEqual(['black', 'wallet', 'park']);
  });

  it('keeps colour, which is one of the few attributes reporters get right', () => {
    expect(tokenize('black')).toEqual(['black']);
  });
});

describe('Bm25Index', () => {
  it('finds an item by a rare exact token an embedding would blur', () => {
    const [top] = index().search('356938035643809', 5);

    expect(top.id).toBe('phone');
  });

  /**
   * An identifier outweighs a pile of ordinary words. Two reports agreeing on
   * a serial number describe one object; two agreeing on "black" and "phone"
   * describe a category.
   */
  it('ranks a shared identifier above a candidate sharing more common words', () => {
    const corpus = new Bm25Index([
      {
        id: 'common-words',
        text: 'Black over-ear headphones found in the cafe, no case, good condition',
      },
      { id: 'identifier', text: 'Headphones handed in, WH-CH720N printed inside the headband' },
    ]);

    const hits = corpus.search('Black over-ear headphones model WH-CH720N lost in the cafe', 5);

    expect(hits[0].id).toBe('identifier');
  });

  it('ranks the better lexical overlap first', () => {
    const hits = index().search('black leather wallet', 5);

    expect(hits[0].id).toBe('wallet');
  });

  it('returns nothing rather than everything for a query with no overlap', () => {
    expect(index().search('bicycle helmet', 5)).toEqual([]);
  });

  it('returns nothing for a query that is all stop words', () => {
    expect(index().search('i lost the item', 5)).toEqual([]);
  });

  it('handles an empty corpus without dividing by its size', () => {
    expect(new Bm25Index([]).search('wallet', 5)).toEqual([]);
  });

  /**
   * The textbook IDF goes negative for a term in more than half the documents.
   * In this corpus that would mean matching "black" actively lowering a score,
   * which is the opposite of what a reporter means by mentioning it.
   */
  it('never scores a match below zero for a common term', () => {
    const common = new Bm25Index([
      { id: 'a', text: 'black phone' },
      { id: 'b', text: 'black wallet' },
      { id: 'c', text: 'black bag' },
    ]);

    common.search('black', 5).forEach((hit) => expect(hit.score).toBeGreaterThan(0));
  });

  it('respects the requested depth', () => {
    expect(index().search('black', 2).length).toBeLessThanOrEqual(2);
  });

  /** Length normalisation: a short document should not lose to a padded one. */
  it('does not let a longer document win on repetition alone', () => {
    const padded = new Bm25Index([
      { id: 'short', text: 'red keyring' },
      {
        id: 'long',
        text: 'red keyring red keyring and a great many other unrelated words about nothing at all whatsoever',
      },
    ]);

    expect(padded.search('red keyring', 2)[0].id).toBe('short');
  });
});
