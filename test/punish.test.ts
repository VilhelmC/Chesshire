// When a punishment is finished, and which way.
//
// ---------------------------------------------------------------------------
// Will: "they already did blunder — the premise of the punishment feature is
// that the opponent just blundered in their last move. You're measuring when
// the punishment is complete wrong. A better measure would probably be
// something like the punishment is complete when user moves are past giving
// back the advantage created by opponent."
//
// The case that makes the point, and the one the old rule could not express at
// all, is the third describe block: a blunder inside a position you are LOSING.
// They go from −2.0 to −0.5, handing you 1.5. Punishing that means keeping the
// 1.5. `ev >= 250` can never fire there however well you play, and a gift read
// off the absolute score is zero, so both halves of the old test were blind to
// the exercise.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { punishOutcome, type Punishment } from '../src/domain/punish';

/** They hung a piece: eval jumped to +150, nothing captured yet. */
const HUNG: Punishment = { base: 150, gift: 300, material: 0 };

describe('taking what was offered', () => {
	it('is finished once the material is on the board', () => {
		// The ordinary case, and what "past giving it back" means: a piece in hand
		// is the one advantage that cannot evaporate.
		expect(punishOutcome(HUNG, 160, 3)).toBe('realized');
	});

	it('is not finished by winning material while the position collapses', () => {
		// Both halves are needed. A pawn grabbed on the way into a mating net is
		// not a punishment taken.
		expect(punishOutcome(HUNG, -400, 1)).toBe('squandered');
	});

	it('keeps going while nothing has been banked and nothing given back', () => {
		expect(punishOutcome(HUNG, 150, 0)).toBe('running');
		expect(punishOutcome(HUNG, 180, 0)).toBe('running');
	});

	it('tolerates measurement noise rather than ending on it', () => {
		// Two searches of one position at different depths differ by a few
		// centipawns, and an ending triggered by that is indistinguishable from
		// one triggered by a mistake.
		expect(punishOutcome(HUNG, 130, 3)).toBe('realized');
	});
});

describe('a punishment that wins nothing material', () => {
	// A shattered king, a bind, a piece trapped rather than captured. Without a
	// rule for this the phase could only ever end by being squandered.
	const POSITIONAL: Punishment = { base: 60, gift: 120, material: 0 };

	it('is finished once the advantage has grown by the gift again', () => {
		expect(punishOutcome(POSITIONAL, 180, 0)).toBe('realized');
	});

	it('is still running short of that', () => {
		expect(punishOutcome(POSITIONAL, 150, 0)).toBe('running');
	});
});

describe('a blunder inside a position you are losing', () => {
	// −2.0 to −0.5. The gift is real; the position is not won and will not be.
	const LOSING: Punishment = { base: -50, gift: 150, material: -3 };

	it('completes by keeping what they gave, not by reaching a winning score', () => {
		// The old rule was `ev >= 250`, which cannot happen here — so a perfectly
		// punished blunder would have run until it was squandered instead.
		expect(punishOutcome(LOSING, -40, -2)).toBe('realized');
	});

	it('measures the give-back against the gift, not against zero', () => {
		// Reading the gift off the absolute score gave zero here, so the only
		// thing left to compare against was the floor. Handing back 100 of 150 is
		// squandering it whatever the sign of the evaluation.
		expect(punishOutcome(LOSING, -150, -3)).toBe('squandered');
	});

	it('is still running while most of the gift is intact', () => {
		expect(punishOutcome(LOSING, -90, -3)).toBe('running');
	});
});

describe('a position already won outright', () => {
	it('is finished whatever the gift was worth', () => {
		expect(punishOutcome({ base: 100, gift: 50, material: 0 }, 400, 0)).toBe('realized');
	});

	it('cannot be squandered while still decisive', () => {
		// You may be playing imprecisely, but there is nothing to teach about
		// losing a chance you still have.
		expect(punishOutcome({ base: 900, gift: 800, material: 5 }, 400, 5)).toBe('realized');
	});
});

describe('nothing is capped by a move count', () => {
	it('keeps running however long it takes', () => {
		// Will: "we should never stop a punishment before it is realized." There
		// is no ply argument here to stop it with, which is the point — three
		// moves is not a property of any position.
		for (let i = 0; i < 50; i++) {
			expect(punishOutcome(HUNG, 150, 0)).toBe('running');
		}
	});
});
