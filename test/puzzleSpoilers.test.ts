// The Puzzles tab must not tell you how deep the puzzle goes.
//
// ---------------------------------------------------------------------------
// Will: "we can't write out the number of moves - that breaks the puzzle - user
// can't know the puzzle depth."
//
// It is worse than a spoiler. "3 moves to find" lets you discard every quiet
// move and every immediate win before looking at the board, which is most of
// the work of solving; and "move 2 of 3" tells you mid-line whether you are
// finished, which is the other half.
//
// A SOURCE test, like `test/regions.test.ts`, because the claim is about what
// the file can possibly render — the repo installs no DOM, and a render test
// would only cover the states it happened to visit. `progress()` is still used
// by the view for what gets RECORDED, so the check is on the count reaching the
// screen, not on the count existing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const view = readFileSync('src/views/Puzzles.tsx', 'utf8');

/** The JSX with comments stripped, so prose about the rule does not trip it. */
const rendered = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the puzzle keeps its depth to itself', () => {
	it('never reads the total off the progress', () => {
		expect(rendered).not.toContain('at.total');
	});

	it('never asks the corpus how many moves the solver has', () => {
		// `solverMoves` is honest and useful — it is how the corpus was measured —
		// and it has no business on this screen.
		expect(rendered).not.toContain('solverMoves');
	});

	it('says none of the things a count would be phrased as', () => {
		for (const said of ['moves to find', 'move to find', ' of ${at', 'Move ${']) {
			expect(rendered).not.toContain(said);
		}
	});

	it('still counts the moves made, which is what gets recorded', () => {
		// The attempt stores how far you got. That is a record of the attempt, not a
		// statement to the solver, and removing it would have been the wrong fix.
		expect(rendered).toContain('movesMade: progress(before).done');
	});
});
