// What the trainer says when a punishment ends, and when it is allowed to.
//
// ---------------------------------------------------------------------------
// Three of Will's reports land on this one sentence, and they compound:
//
//   #1  "App is telling me my position is much better but I'm losing."
//       `describeAdvantage` had an unstated precondition — that it is only
//       called on a winning position — and two callers, one of which did not
//       meet it. Everything that was not a material lead fell through to an
//       else branch reading "Your position is much better", with the
//       contradicting number printed immediately after it.
//
//   "We should never stop a punishment before it is realized."
//       It stopped after three plies whatever was happening. Three is not a
//       property of any position: a two-move tactic and a technical conversion
//       are both punishments and only one of them fits. The cap cut off the
//       exercises with most to teach and labelled the failures as successes.
//
//   "It should be reporting the delta caused by the punishment — how much the
//    position shifted, not the absolute advantage."
//       The absolute number is mostly a report on THEIR move: the blunder made
//       the advantage and the drill begins after it. It also read identically
//       whether you doubled the advantage or halved it.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { describeAdvantage } from '../src/engine/session';
import { INITIAL_FEN } from '../src/domain/chess';

/** A position with nothing captured, so material never carries the sentence. */
const LEVEL = INITIAL_FEN;

describe('the shift, not the score', () => {
	it('shows both ends and what was added', () => {
		// The form anybody can check against the bar they were watching.
		const said = describeAdvantage(LEVEL, 'w', 310, 'realized', [], 80);
		expect(said).toContain('+0.8');
		expect(said).toContain('+3.1');
		expect(said).toMatch(/added 2\.3/);
	});

	it('says so when the advantage shrank', () => {
		// The case the absolute number could not express at all: it reported the
		// same "+0.9" whether you had doubled it or halved it.
		const said = describeAdvantage(LEVEL, 'w', 90, 'squandered', [], 400);
		expect(said).toMatch(/gave back 3\.1/);
		expect(said).not.toMatch(/added/);
	});

	it('falls back to the plain score with no baseline', () => {
		// Callers outside the punish phase have nothing to subtract.
		expect(describeAdvantage(LEVEL, 'w', 700, 'realized')).toContain('+7.0');
	});
});

describe('when the chance has gone', () => {
	it('does not claim an advantage in a lost position', () => {
		// Will's issue #1, exactly.
		const said = describeAdvantage(LEVEL, 'w', -850, 'squandered', [], 200);
		expect(said).not.toMatch(/much better/i);
		expect(said).toMatch(/worse/i);
	});

	it('does not claim one in a level position either', () => {
		expect(describeAdvantage(LEVEL, 'w', 20, 'squandered', [], 300)).not.toMatch(/much better/i);
	});

	it('says the chance is gone rather than that the drill is done', () => {
		// "That is as far as the drill goes" implied it got where it was going.
		const said = describeAdvantage(LEVEL, 'w', -400, 'squandered', [], 250);
		expect(said).toMatch(/chance has gone/i);
		// And never mentions a move count, because nothing counts moves any more.
		expect(said).not.toMatch(/\bmoves\b/i);
	});
});

describe('when the punishment came off', () => {
	it('says the gift is banked, not that you are winning', () => {
		// Will: "the punishment is complete when user moves are past giving back
		// the advantage created by opponent." A punishment can be complete in a
		// position you are still losing — they gave you 1.5 and you kept it —
		// so the ending may not claim a win it has not checked for.
		const said = describeAdvantage(LEVEL, 'w', 700, 'realized', [], 150);
		expect(said).toMatch(/much better/i);
		expect(said).toMatch(/yours now/i);
	});

	it('says the same thing in a position that is still lost', () => {
		// Their blunder took it from -2.0 to -0.5 and you kept the 1.5. That IS
		// the exercise, and the old absolute bar could never have registered it.
		const said = describeAdvantage(LEVEL, 'w', -50, 'realized', [], -200);
		expect(said).toMatch(/yours now/i);
		expect(said).toMatch(/added 1\.5/);
		expect(said).not.toMatch(/\bbetter\b/i);
	});
});

describe('the evaluation and the words agree', () => {
	// The invariant issue #1 broke. Whatever the reason and whatever the
	// baseline, a sentence claiming the reader is better may not carry a
	// negative score.
	for (const cp of [-2000, -900, -300, -60, 0, 60, 300, 900, 2000]) {
		for (const reason of ['realized', 'squandered'] as const) {
			it(`${cp}cp, ${reason}`, () => {
				const said = describeAdvantage(LEVEL, 'w', cp, reason, [], 100);
				if (cp <= 0) {
					expect(said, said).not.toMatch(/\bbetter\b/i);
				} else {
					expect(said, said).not.toMatch(/\bworse\b/i);
				}
			});
		}
	}
});
