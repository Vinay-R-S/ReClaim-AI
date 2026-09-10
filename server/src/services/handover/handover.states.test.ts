/**
 * The transition table.
 *
 * The file with the most tests in the phase, because it is the file that
 * replaces a rule enforced by remembering to check. Under the old design a
 * blocked session was reopened by any code path that forgot the guard; here a
 * move that is not in the table does not happen, so what has to be tested is
 * the table itself.
 *
 * The absences matter as much as the entries, so they are tested by name
 * rather than left implied by the entries that exist.
 */

import { describe, expect, it } from 'vitest';
import {
  acceptsCode,
  allowedFrom,
  canTransition,
  fromLegacyStatus,
  HANDOVER_STATES,
  HANDOVER_TRANSITIONS,
  isHandoverState,
  isTerminal,
  nextState,
  project,
  toLegacyStatus,
  type HandoverState,
} from './handover.states.js';

describe('the table', () => {
  it('takes a new session from initiated to code_issued', () => {
    expect(nextState('initiated', 'issue_code')).toBe('code_issued');
  });

  it('lets a re-trigger of matching re-issue an open session', () => {
    expect(nextState('code_issued', 'issue_code')).toBe('code_issued');
  });

  it('takes an accepted code to verified, and a finished saga to completed', () => {
    expect(nextState('code_issued', 'confirm_receipt')).toBe('verified');
    expect(nextState('verified', 'complete')).toBe('completed');
  });

  it('routes a presented code through awaiting_meet when two-party is on', () => {
    expect(nextState('code_issued', 'present_code')).toBe('awaiting_meet');
    expect(nextState('awaiting_meet', 'confirm_receipt')).toBe('verified');
  });

  it('blocks a session at the attempt cap and keeps it in place on a failure', () => {
    expect(nextState('code_issued', 'fail_attempt')).toBe('code_issued');
    expect(nextState('code_issued', 'block')).toBe('blocked');
  });
});

describe('what the table refuses', () => {
  /**
   * Defect LOG-11, made structural.
   *
   * The old code reopened a blocked session because `initiateHandover`
   * overwrote the document; it was fixed by adding a check to that one path.
   * This is the same rule expressed as a missing edge, so a path added later
   * cannot reintroduce it without deliberately adding the edge.
   */
  it('has no way back from blocked except an admin re-issue', () => {
    expect(canTransition('blocked', 'issue_code')).toBe(false);
    expect(canTransition('blocked', 'present_code')).toBe(false);
    expect(canTransition('blocked', 'confirm_receipt')).toBe(false);
    expect(canTransition('blocked', 'fail_attempt')).toBe(false);

    expect(nextState('blocked', 'reissue_code')).toBe('code_issued');
  });

  it('lets an expired session be re-issued by either path, as it always could', () => {
    // The old flow refused only `verified` and `blocked`, so a re-triggered
    // match run or an admin re-verifying the match re-issued an expired code
    // freely. Dropping `issue_code` turned both into a 400.
    expect(nextState('expired', 'issue_code')).toBe('code_issued');
    expect(nextState('expired', 'reissue_code')).toBe('code_issued');
  });

  it('lets an admin issue a code for a match that has never had one', () => {
    expect(nextState('initiated', 'reissue_code')).toBe('code_issued');
  });

  it('never quietly rewinds a completed handover', () => {
    const survivors = allowedFrom('completed');

    expect(survivors.sort()).toEqual(['dispute', 'revert']);
    expect(canTransition('completed', 'issue_code')).toBe(false);
    expect(canTransition('completed', 'reissue_code')).toBe(false);
    expect(canTransition('completed', 'complete')).toBe(false);
  });

  it('does not accept a code against a session that is not live', () => {
    expect(acceptsCode('code_issued')).toBe(true);
    expect(acceptsCode('awaiting_meet')).toBe(true);

    (['blocked', 'expired', 'verified', 'completed', 'cancelled', 'disputed', 'reverted'] as const).forEach(
      (state) => expect(acceptsCode(state)).toBe(false),
    );
  });

  it('lets a verified handover be reopened, because the saga can give up', () => {
    // Not a rewind: nothing has completed. A session left verified with no
    // handover record behind it would otherwise be stranded, which is the
    // failure phase 7 had to add a code path to escape.
    expect(nextState('verified', 'reissue_code')).toBe('code_issued');
  });
});

describe('terminality', () => {
  it('names the three states nothing follows on its own', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('reverted')).toBe(true);

    expect(isTerminal('blocked')).toBe(false);
    expect(isTerminal('expired')).toBe(false);
  });
});

describe('every state and transition', () => {
  it('gives each state an entry, so a new one cannot be half added', () => {
    HANDOVER_STATES.forEach((state) => {
      expect(() => allowedFrom(state)).not.toThrow();
    });
  });

  it('uses every declared transition somewhere in the table', () => {
    const used = new Set(HANDOVER_STATES.flatMap((state) => allowedFrom(state)));

    HANDOVER_TRANSITIONS.forEach((transition) => {
      expect(used.has(transition)).toBe(true);
    });
  });

  it('only ever leads to a declared state', () => {
    HANDOVER_STATES.forEach((state) => {
      allowedFrom(state).forEach((transition) => {
        const to = nextState(state, transition) as HandoverState;

        expect(isHandoverState(to)).toBe(true);
      });
    });
  });

  it('leaves every state reachable from a new session', () => {
    // Otherwise a state is a value the machine declares and can never be in,
    // which is a state the admin screen has a branch for and never shows.
    const seen = new Set<HandoverState>(['initiated']);
    const queue: HandoverState[] = ['initiated'];

    while (queue.length > 0) {
      const state = queue.shift() as HandoverState;

      allowedFrom(state).forEach((transition) => {
        const to = nextState(state, transition) as HandoverState;

        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      });
    }

    expect([...seen].sort()).toEqual([...HANDOVER_STATES].sort());
  });
});

describe('reading a document written before the event log', () => {
  it('reads a stored verified as completed, not as the new intermediate', () => {
    // The old flow completed inline the moment the code was accepted, so a
    // stored `verified` is a handover that finished. Reading it as the new
    // `verified` would offer an admin a session to reopen that has already
    // happened.
    expect(fromLegacyStatus('verified')).toBe('completed');
  });

  it('maps the rest across unchanged', () => {
    expect(fromLegacyStatus('pending')).toBe('code_issued');
    expect(fromLegacyStatus('blocked')).toBe('blocked');
    expect(fromLegacyStatus('expired')).toBe('expired');
  });

  it('fails closed on anything it cannot classify', () => {
    // `initiated` accepts no credential and has only `issue_code` and `cancel`
    // out of it. Defaulting to `code_issued`, the most permissive live state,
    // made a half-written or corrupt document a handover anybody could
    // transition.
    expect(fromLegacyStatus(undefined)).toBe('initiated');
    expect(fromLegacyStatus('something else')).toBe('initiated');

    expect(acceptsCode(fromLegacyStatus(undefined))).toBe(false);
  });

  it('projects only a genuinely finished handover onto the legacy verified', () => {
    // The blanket "every state maps to one of the four" assertion this
    // replaces was guaranteed by the return type: replacing the whole switch
    // with `return 'pending'` kept it green.
    const finished = HANDOVER_STATES.filter((state) => toLegacyStatus(state) === 'verified');

    expect(finished).toEqual(['completed']);
  });

  it('does not report an unfinished handover as verified to a stale reader', () => {
    expect(toLegacyStatus('code_issued')).toBe('pending');
    expect(toLegacyStatus('awaiting_meet')).toBe('pending');
    expect(toLegacyStatus('completed')).toBe('verified');
  });

  it('leaves a session whose saga has not finished visible to the admin list', () => {
    // `verified` now means only that the credential was accepted. Projecting
    // it to the legacy `verified` asserted a handover that may still fail, and
    // hid a stuck session from `listOpenSessions`, which queries pending,
    // blocked and expired.
    expect(toLegacyStatus('verified')).toBe('pending');
  });
});

describe('projection', () => {
  it('is the last event, and nothing else', () => {
    const at = new Date();

    expect(
      project([
        { from: null, to: 'code_issued', transition: 'issue_code', at },
        { from: 'code_issued', to: 'blocked', transition: 'block', at },
        { from: 'blocked', to: 'code_issued', transition: 'reissue_code', at },
      ]),
    ).toBe('code_issued');
  });

  it('has no state for a handover nothing has happened to', () => {
    expect(project([])).toBeNull();
  });
});
