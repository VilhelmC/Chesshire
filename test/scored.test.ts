// A row existing is not the same fact as a game having been analysed.
//
// ---------------------------------------------------------------------------
// Will: "I notice many of the games in my review list are incompletely scored —
// often only a handful of plies at the beginning of the game."
//
// Import stored a row whether or not the walk finished, and then decided what
// to skip next time by asking whether the row existed. The two facts had been
// conflated, and this is the test that keeps them apart. See
// `domain/scored.ts`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { COMPLETE_ENOUGH, coverage, fullyScored, scoredPlies, scoringNote } from '../src/domain/scored';

/** A game of `plies` plies, measured up to `to`. */
const partial = (plies: number, to: number) =>
	Array.from({ length: plies }, (_, i) => (i < to ? 10 : null));

describe('counting what was measured', () => {
	it('counts the numbers, whichever indexing convention the array uses', () => {
		// A stored game is one entry per ply; a Reviewable carries a leading null
		// for the starting position, which is not a ply. Counting non-nulls is
		// right under both, which is why it is not parameterised by convention.
		expect(scoredPlies([10, 20, 30])).toBe(3);
		expect(scoredPlies([null, 10, 20, 30])).toBe(3);
		expect(scoredPlies(undefined)).toBe(0);
	});

	it('reports coverage as a share of the game', () => {
		expect(coverage(partial(40, 8), 40)).toBeCloseTo(0.2);
		expect(coverage(partial(40, 40), 40)).toBe(1);
		// A game with no plies cannot be partly measured.
		expect(coverage([], 0)).toBe(0);
	});
});

describe('what comes back for another look', () => {
	it('leaves a game alone once nearly all of it is measured', () => {
		// One position the engine refused should not condemn a game to being
		// re-analysed on every import for ever.
		expect(fullyScored(partial(100, 99), 100)).toBe(true);
		expect(fullyScored(partial(100, 100), 100)).toBe(true);
	});

	it('picks up a game whose walk was cut short', () => {
		// The symptom, exactly: a handful of plies at the beginning.
		expect(fullyScored(partial(60, 8), 60)).toBe(false);
		expect(COMPLETE_ENOUGH).toBeLessThan(1);
	});

	it('picks up a game that was never measured at all', () => {
		// Which happens when the site had no analysis and the engine could not
		// start. The engine check at the top of import is what stops that looping.
		expect(fullyScored([], 60)).toBe(false);
		expect(fullyScored(undefined, 60)).toBe(false);
	});

	it('picks up a legacy row that kept no moves', () => {
		// `plies` is 0 for those, so they read as unmeasured — which is right:
		// they cannot be reviewed at all until the moves are stored.
		expect(fullyScored([10, 20], 0)).toBe(false);
	});
});

describe('what the reader is told', () => {
	it('says nothing when the whole game is scored', () => {
		expect(scoringNote(partial(30, 30), 30)).toBe(null);
	});

	it('gives the numbers rather than a vague warning', () => {
		// "Partially scored" invites the question this answers.
		expect(scoringNote(partial(60, 8), 60)).toBe('8 of 60 plies scored');
	});

	it('says plainly when nothing was scored', () => {
		expect(scoringNote(partial(60, 0), 60)).toBe('none of this game was scored');
	});
});
