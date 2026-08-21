// Accuracy over your games, and what it is allowed to claim.
//
// The rule these pin down: a game with any unevaluated ply is not a smaller
// sample, it is absent data. Averaging over the moves that happened to get
// analysed produces a number that describes the analysis rather than the play.

import { describe, it, expect } from 'vitest';
import {
	isMeasurable,
	exclusionReason,
	measurableEvals,
	scoreGame,
	acplOf,
	performanceReport,
	accuracyByBand,
	weakestBand,
	MIN_MOVES_PER_BAND,
	type MeasurableGame,
} from '../src/domain/performance';

/**
 * A game long enough to be worth scoring.
 *
 * Eight plies rather than four, because `MIN_PLIES` refuses anything shorter —
 * an "accuracy" derived from two moves is noise wearing a decimal point, and no
 * real game is that short anyway. The fixtures should look like the input.
 */
const game = (over: Partial<MeasurableGame> = {}): MeasurableGame => ({
	id: 'g1',
	playedAt: 1,
	ourColour: 'w',
	moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'd6'],
	evals: [20, 10, 25, 5, 30, 12, 28, 8],
	...over,
});

/** The same game with one ply's evaluation replaced. */
const withPly = (i: number, v: number | null): MeasurableGame => {
	const g = game();
	(g.evals as (number | null)[])[i] = v;
	return g;
};

/**
 * White throws the game away on ply 3 and Black then HOLDS it.
 *
 * The holding matters. Dropping the evaluation and letting it spring back means
 * Black handed the advantage straight back, which is a second blunder — and the
 * counter is right to charge it. Isolating one side's mistake means keeping the
 * evaluation where it landed.
 */
const whiteBlunders = (): MeasurableGame => {
	const g = game();
	const e = g.evals as number[];
	for (let i = 2; i < e.length; i++) e[i] = -700;
	return g;
};

describe('isMeasurable', () => {
	it('accepts a game where every ply was evaluated', () => {
		expect(isMeasurable(game())).toBe(true);
	});

	it('rejects a game imported before evaluations were stored', () => {
		expect(isMeasurable(game({ evals: undefined }))).toBe(false);
	});

	it('rejects a game with a gap in the MIDDLE rather than skipping it', () => {
		// Dropping the null and averaging the rest would silently describe the
		// moves that got analysed rather than the moves that were played.
		expect(isMeasurable(withPly(3, null))).toBe(false);
	});

	it('accepts a game whose LAST position was never evaluated', () => {
		// The bug that cost fifteen games out of twenty. When the opponent plays
		// the last move of the game, nothing evaluates the final position — and
		// that position is after THEIR move, so it contributes nothing to our
		// accuracy. Dropping it costs nothing; dropping the game cost everything.
		const g = game();
		(g.evals as (number | null)[])[g.evals!.length - 1] = null;
		expect(isMeasurable(g)).toBe(true);
		expect(measurableEvals(g)!.length).toBe(g.moves!.length - 1);
	});

	it('rejects a game with fewer evaluations than moves', () => {
		expect(isMeasurable(game({ evals: [20, 10] }))).toBe(false);
	});

	it('refuses a game too short to say anything about', () => {
		// Two moves cannot produce an accuracy; a number derived from them would
		// be noise presented as a measurement.
		expect(isMeasurable(game({ moves: ['e4', 'e5'], evals: [20, 10] }))).toBe(false);
		expect(exclusionReason(game({ moves: ['e4', 'e5'], evals: [20, 10] }))).toMatch(/too short/);
	});

	it('rejects a game with no moves recorded', () => {
		expect(isMeasurable(game({ moves: undefined }))).toBe(false);
	});
});

describe('scoreGame', () => {
	it('returns nothing at all for an unmeasurable game', () => {
		// Null, not zero. A zero would be a claim about how badly it was played.
		expect(scoreGame(game({ evals: undefined }))).toBeNull();
	});

	it('scores a clean game high', () => {
		const s = scoreGame(game())!;
		expect(s.accuracy).toBeGreaterThan(85);
		expect(s.blunders).toBe(0);
	});

	it('charges the blunder to us when it is our move', () => {
		// Ply 3 is White's, and we are White.
		const s = scoreGame(whiteBlunders())!;
		expect(s.blunders).toBe(1);
	});

	it('does not charge us for the opponent throwing it away', () => {
		// Same collapse, but we are Black — so the blunder is not ours.
		const s = scoreGame({ ...whiteBlunders(), ourColour: 'b' })!;
		expect(s.blunders).toBe(0);
	});
});

describe('acplOf', () => {
	it('counts only our own moves', () => {
		// White plays plies 1 and 3. Between them Black's move changes nothing
		// about what White lost.
		expect(acplOf([15, -400, 15, -400], 'w')).toBe(0);
	});

	it('measures a loss from our point of view when we are Black', () => {
		// White-POV evals rising is Black losing ground.
		expect(acplOf([15, 215], 'b')).toBe(200);
	});

	it('never counts a gain as a negative loss', () => {
		// A move that improves your position is zero loss, not a credit that
		// offsets a blunder elsewhere.
		expect(acplOf([15, 15, 500, 500], 'w')).toBe(0);
	});
});

describe('exclusionReason', () => {
	it('says nothing about a game it can score', () => {
		expect(exclusionReason(game())).toBeNull();
	});

	it('distinguishes never-analysed from stopped-partway', () => {
		// Different causes, different remedies. "15 excluded" with no reason is
		// exactly the kind of number this project exists not to ship.
		expect(exclusionReason(game({ evals: undefined }))).toMatch(/no evaluations/);
		expect(exclusionReason(withPly(3, null))).toMatch(/stopped partway/);
	});

	it('names a missing move list separately from missing evaluations', () => {
		expect(exclusionReason(game({ moves: undefined }))).toMatch(/no moves/);
	});
});

describe('performanceReport', () => {
	it('reports unmeasured games rather than dropping them', () => {
		const r = performanceReport([game(), { ...game(), id: 'g2', evals: undefined }]);
		expect(r.scored.length).toBe(1);
		expect(r.unmeasured).toBe(1);
	});

	it('tallies WHY they were excluded', () => {
		const r = performanceReport([
			game(),
			{ ...game(), id: 'a', evals: undefined },
			{ ...game(), id: 'b', evals: undefined },
			{ ...withPly(3, null), id: 'c' },
		]);
		expect(r.unmeasured).toBe(3);
		expect(r.reasons[0]).toEqual({ reason: expect.stringMatching(/no evaluations/), count: 2 });
		expect(r.reasons.map((x) => x.count).reduce((a, b) => a + b, 0)).toBe(3);
	});

	it('says nothing when nothing is measurable', () => {
		const r = performanceReport([{ ...game(), evals: undefined }]);
		expect(r.accuracy).toBeNull();
		expect(r.recent).toBeNull();
		expect(r.unmeasured).toBe(1);
	});

	it('puts the newest games first, so "recent" means recent', () => {
		const r = performanceReport([
			{ ...game(), id: 'old', playedAt: 1 },
			{ ...game(), id: 'new', playedAt: 99 },
		]);
		expect(r.scored[0].id).toBe('new');
	});
});

describe('accuracyByBand', () => {
	/** A game where play falls apart after move 10. */
	const collapsing = (): MeasurableGame => {
		const evals: number[] = [];
		// 40 plies. White holds level for 20, then bleeds.
		for (let i = 0; i < 20; i++) evals.push(i % 2 === 0 ? 20 : 10);
		for (let i = 20; i < 40; i++) evals.push(i % 2 === 0 ? -60 * (i - 19) : -60 * (i - 19) - 30);
		return game({ moves: new Array(40).fill('e4'), evals });
	};

	it('withholds a band average when there are too few moves in it', () => {
		const bands = accuracyByBand([game()]);
		// Four plies, two of them ours: nothing near the minimum.
		expect(bands.every((b) => b.accuracy === null || b.moves >= MIN_MOVES_PER_BAND)).toBe(true);
	});

	it('finds the stage where play falls off', () => {
		const bands = accuracyByBand([collapsing(), collapsing(), collapsing()]);
		const early = bands.find((b) => b.label === 'moves 1–10')!;
		const later = bands.find((b) => b.label === 'moves 11–20')!;
		expect(early.accuracy).not.toBeNull();
		expect(later.accuracy).not.toBeNull();
		expect(later.accuracy!).toBeLessThan(early.accuracy!);
	});

	it('counts only our own moves into the bands', () => {
		const bands = accuracyByBand([game({ ourColour: 'w' })]);
		const total = bands.reduce((n, b) => n + b.moves, 0);
		// Eight plies, four of which are White's.
		expect(total).toBe(4);
	});
});

describe('weakestBand', () => {
	it('says nothing without at least two comparable bands', () => {
		expect(weakestBand([{ label: 'moves 1–10', accuracy: 90, moves: 20 }])).toBeNull();
		expect(weakestBand([{ label: 'moves 1–10', accuracy: null, moves: 2 }])).toBeNull();
	});

	it('names one band, not a list of weaknesses', () => {
		const worst = weakestBand([
			{ label: 'moves 1–10', accuracy: 92, moves: 40 },
			{ label: 'moves 11–20', accuracy: 61, moves: 40 },
			{ label: 'moves 21–30', accuracy: 74, moves: 40 },
		]);
		expect(worst?.label).toBe('moves 11–20');
	});
});
