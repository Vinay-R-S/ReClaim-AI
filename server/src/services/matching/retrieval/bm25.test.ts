/**
 * The lexical half of retrieval.
 *
 * It exists for the cases an embedding blurs: a serial number, a model string,
 * a name written inside a bag. So what is worth pinning is that an exact rare
 * token wins, that a common one does not, and that the IDF cannot go negative
 * and start subtracting score for matching the very word the search is about.
 */

import { describe, expect, it } from 'vitest';
import { Bm25Index, tokenize } from './bm25.js';

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

describe('tokenize', () => {
  it('keeps digits joined to letters, so a model number stays one token', () => {
    expect(tokenize('iPhone 13 IMEI 356938035643809')).toContain('356938035643809');
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
