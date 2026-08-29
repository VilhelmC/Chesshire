// The Lab's verdicts must not flatter the detector.
//
// ---------------------------------------------------------------------------
// The first version of this screen said "Found it" whenever the puzzle's answer
// was among the top-scoring moves. On a quiet position where eleven moves all
// score zero that is true and worthless — the answer is "among the best" only
// because nothing was discriminated at all. Counting that as a success is the
// single way this screen could lie, so the three-way verdict is pinned here:
//
//   found   the answer was preferred to (nearly) everything else
//   tied    the answer scored top, but so did a crowd — no opinion was expressed
//   missed  something else was preferred
//
// The shipped labPuzzles.json is checked against the same rule, over the SOLVER's
// plies only, so the filter counts on screen cannot drift away from what the
// annotation says.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { chainOf, detailOf, type Puzzle } from '../src/views/Lab';
import PUZZLES from '../src/data/labPuzzles.json';

const ALL = PUZZLES as Puzzle[];

function puzzle(fen: string, moves: string[]): Puzzle {
	return {
		id: 't',
		fen,
		moves,
		rating: 0,
		themes: [],
		clean: false,
		sharp: false,
		firm: false,
		firstMiss: -1,
		plies: [],
	};
}

/** Chain plus the live evaluation of one ply. */
const detailAt = (p: Puzzle, i: number) => detailOf(chainOf(p)[i]);

describe('Lab annotation', () => {
	it('calls a forced mate found, not tied', () => {
		// Back rank: after 1.Kg1 the only move that mates is 1...Re1#, and it must
		// stand alone in the ranking. Move 0 is the blunder, as in every Lichess row.
		const p = puzzle('4r1k1/5ppp/8/8/8/8/5PPP/7K w - - 0 1', ['h1g1', 'e8e1']);
		const steps = chainOf(p);
		expect(steps).toHaveLength(2);
		expect(steps[0].solver).toBe(false);
		expect(steps[1].solver).toBe(true);
		const d = detailAt(p, 1);
		expect(d.verdict).toBe('found');
		expect(d.ties).toBe(1);
	});

	it('calls a wide tie "tied" rather than a success', () => {
		// Kings and one pawn: five legal moves, none of which changes any material.
		// The played move is "among the best" and that fact carries no information.
		const p = puzzle('4k3/8/8/8/8/8/4P3/3K4 w - - 0 1', ['d1e1', 'e8e7']);
		const d = detailAt(p, 1);
		expect(d.playedScore).toBe(d.best[0].score);
		expect(d.ties).toBeGreaterThan(2);
		expect(d.verdict).toBe('tied');
	});

	it('a single legal move is a find, not a tie', () => {
		// Nothing is discriminated when there is only one move — but nothing can be
		// got wrong either, so it must not be reported as a shrug.
		const p = puzzle('7k/8/6Q1/8/8/8/8/R5K1 w - - 0 1', ['g6g7', 'h8g7']);
		const d = detailAt(p, 1);
		expect(d.legal).toBe(1);
		expect(d.verdict).toBe('found');
	});

	it('marks the opponent replies as not the solver’s', () => {
		// Will: "the discriminator really only has to hit the moves of the side that
		// is solving the puzzle … opponent can have branches or degrees of freedom
		// that don't change outcome."
		const p = ALL.find((q) => q.moves.length >= 4);
		expect(p).toBeDefined();
		const steps = chainOf(p as Puzzle);
		expect(steps.map((s) => s.solver)).toEqual(
			steps.map((_, i) => i > 0 && i % 2 === 1),
		);
	});

	it('keeps the puzzle move in the ranking even when it ranks badly', () => {
		for (const p of ALL.filter((q) => !q.clean).slice(0, 6)) {
			const steps = chainOf(p);
			for (let i = 1; i < steps.length; i++) {
				const d = detailOf(steps[i]);
				// Every ply must be able to show the reader the move the puzzle plays;
				// a table that omits the answer is the one thing this screen must not
				// do.
				if (d.playedRank !== null) {
					expect(d.rank.map((r) => r.score)).toContain(d.playedScore);
				}
			}
		}
	});

	it('the shipped flags agree with the live annotation, on solver plies', () => {
		// The counts on screen come from the JSON; the verdicts come from running
		// the detector in the browser. If those two ever disagree the filter is
		// lying about what the reader is looking at.
		for (const p of ALL.slice(0, 12)) {
			const steps = chainOf(p).filter((s) => s.solver);
			const details = steps.map(detailOf);
			expect(details.every((d) => d.verdict !== 'missed')).toBe(p.clean);
			expect(details.every((d) => d.verdict === 'found')).toBe(p.sharp);
		}
	});
});
