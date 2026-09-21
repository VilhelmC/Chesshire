// What the evaluation graph is allowed to claim.
//
// ---------------------------------------------------------------------------
// Will: "I don't quite understand the evaluation graph since it is missing
// legend? How does user tell opponent and own mistakes / blunders /
// inaccuracies apart if every point of the graph is a full ply (your and
// opponent move)? Wouldn't it make more sense to alternate so it is always
// clear which point on the graph belongs to which player? So a point on the
// graph is a half ply?"
//
// It already was a half ply. The chart simply had nothing on it that said so,
// which made Will's reading the only available one. Two of the three pieces
// that fix that are arithmetic — where the move bands fall and which move
// numbers get printed — and the third is the one that matters most: WHERE THE
// GAPS ARE.
//
// A gap is a stretch nobody measured. The old chart drew a straight line
// through one, which is the chart stating something false, and is what made
// "many of my games are incompletely scored" hard to notice at all. So the
// ranges are computed here and pinned here.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { bands, gaps, ticks } from '../src/components/EvalGraph';

describe('the move bands', () => {
	it('are two plies wide, starting at move 1', () => {
		// A band is a whole move. Which HALF of a band a point sits in is what
		// tells a reader whose move it was — the alternation, made visible.
		expect(bands(6)).toEqual([
			{ move: 1, from: 0, to: 2 },
			{ move: 2, from: 2, to: 4 },
			{ move: 3, from: 4, to: 6 },
		]);
	});

	it('does not run a half-empty band past the end of the game', () => {
		// A game ending on White's move leaves half a band; drawing the whole one
		// would shade plies that were never played.
		expect(bands(5)).toEqual([
			{ move: 1, from: 0, to: 2 },
			{ move: 2, from: 2, to: 4 },
			{ move: 3, from: 4, to: 5 },
		]);
	});

	it('has none in a game with no moves', () => {
		expect(bands(0)).toEqual([]);
	});
});

describe('the move numbers along the bottom', () => {
	it('thins out as the game gets longer, so labels cannot collide', () => {
		// Chosen from the game's LENGTH, not the measured width: a label that
		// appears and disappears as a panel resizes is worse than a sparse one.
		expect(ticks(20).map((t) => t.move)).toEqual([2, 4, 6, 8, 10]);
		expect(ticks(60).map((t) => t.move)).toEqual([5, 10, 15, 20, 25, 30]);
		expect(ticks(100).map((t) => t.move)).toEqual([10, 20, 30, 40, 50]);
	});

	it('puts each label at the ply that ends that move', () => {
		expect(ticks(20)[0]).toEqual({ move: 2, at: 4 });
	});

	it('prints nothing for an empty game', () => {
		expect(ticks(0)).toEqual([]);
	});
});

describe('the stretches nobody measured', () => {
	const at = (...plies: (number | null)[]) => [null, ...plies];

	it('finds none when every ply carries a number', () => {
		expect(gaps(at(10, 20, 30, 40), 4)).toEqual([]);
	});

	it('reports a run in the middle, anchored to the plies either side of it', () => {
		// Plies 2 and 3 are missing, so the gap spans from the last measured ply
		// to the next one — that is the stretch the line must not be drawn across.
		expect(gaps(at(10, null, null, 40), 4)).toEqual([{ from: 1, to: 3 }]);
	});

	it('reports a game that was measured and then abandoned', () => {
		// Will's actual case: "only a handful of plies at the beginning". It runs
		// to the end of the game rather than stopping at the last null, because
		// the unmeasured stretch really does continue to the end.
		expect(gaps(at(10, 20, null, null, null, null), 6)).toEqual([{ from: 2, to: 6 }]);
	});

	it('does not treat the starting position as a gap', () => {
		// Ply 0 is never a measurement — `annotate` supplies the known starting
		// value — so a null there is the convention, not a hole.
		expect(gaps(at(10, 20), 2)).toEqual([]);
	});

	it('reports the whole game when nothing was measured', () => {
		expect(gaps(at(null, null, null), 3)).toEqual([{ from: 0, to: 3 }]);
	});
});
