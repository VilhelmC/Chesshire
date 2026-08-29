// What the Lab still asserts, now that the detector it was written for is gone.
//
// ---------------------------------------------------------------------------
// This file used to pin the OLD DEPTH SEARCH's three-way verdict — found / tied
// / missed — because the first version of that screen said "Found it" whenever
// the puzzle's answer was among the top-scoring moves, which on a quiet position
// where eleven moves all score zero is true and worthless.
//
// That argument was right and it is not gone: it moved to `attic/depth-search/`
// with `resolve.ts` and the rest of stack 1 (M6), and the whole of that reasoning
// is preserved in `attic/depth-search/lab-detector.test.ts`. It is not deleted,
// it is withdrawn from the build, per `AMEND-ARCHIVE-NOT-DELETE.md`.
//
// What survives here is `chainOf`, which has no evaluator in it at all: it walks
// a puzzle into positions and marks which plies the solver is responsible for.
// That is still load-bearing — every panel on the screen is keyed on it — and it
// is the one thing in this file that never depended on which detector was
// running.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { chainOf, type Puzzle } from '../src/views/Lab';
import PUZZLES from '../src/data/labPuzzles.json';

const ALL = PUZZLES as Puzzle[];

describe('the chain', () => {
	it('marks the opponent replies as not the solver’s', () => {
		// Will: "the discriminator really only has to hit the moves of the side that
		// is solving the puzzle … opponent can have branches or degrees of freedom
		// that don't change outcome."
		const p = ALL.find((q) => q.moves.length >= 4);
		expect(p).toBeDefined();
		const steps = chainOf(p as Puzzle);
		expect(steps.map((s) => s.solver)).toEqual(steps.map((_, i) => i > 0 && i % 2 === 1));
	});

	it('walks every ply of the solution into a position', () => {
		const p = ALL.find((q) => q.moves.length >= 4) as Puzzle;
		const steps = chainOf(p);
		expect(steps).toHaveLength(p.moves.length);
		// Each step carries the position the move is played FROM, so the first is
		// the puzzle's own FEN and every later one differs from its predecessor.
		expect(steps[0].played).toBe(p.moves[0]);
		for (let i = 1; i < steps.length; i++) expect(steps[i].pos).not.toBe(steps[i - 1].pos);
	});

	it('gives up cleanly on a position it cannot parse', () => {
		// A malformed row in the shipped JSON must not take the screen down with it.
		expect(chainOf({ ...(ALL[0] as Puzzle), fen: 'not a fen' })).toEqual([]);
	});
});
