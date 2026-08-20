// Accuracy over your games, and what it is allowed to claim.
//
// The rule these pin down: a game with any unevaluated ply is not a smaller
// sample, it is absent data. Averaging over the moves that happened to get
// analysed produces a number that describes the analysis rather than the play.

import { describe, it, expect } from 'vitest';
import {
	isMeasurable,
	scoreGame,
	acplOf,
	performanceReport,
	accuracyByBand,
	weakestBand,
	MIN_MOVES_PER_BAND,
	type MeasurableGame,
} from '../src/domain/performance';

const game = (over: Partial<MeasurableGame> = {}): MeasurableGame => ({
	id: 'g1',
	playedAt: 1,
	ourColour: 'w',
	moves: ['e4', 'e5', 'Nf3', 'Nc6'],
	evals: [20, 10, 25, 5],
	...over,
});

describe('isMeasurable', () => {
	it('accepts a game where every ply was evaluated', () => {
		expect(isMeasurable(game())).toBe(true);
	});

	it('rejects a game imported before evaluations were stored', () => {
		expect(isMeasurable(game({ evals: undefined }))).toBe(false);
	});

	it('rejects a game with a gap rather than skipping the gap', () => {
		// This is the important one. Dropping the null and averaging the rest
		// would silently describe the moves that got analysed.
		expect(isMeasurable(game({ evals: [20, null, 25, 5] }))).toBe(false);
	});

	it('rejects a game with fewer evaluations than moves', () => {
		expect(isMeasurable(game({ evals: [20, 10] }))).toBe(false);
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
		const s = scoreGame(game({ evals: [20, 10, -700, -700] }))!;
		expect(s.blunders).toBe(1);
	});

	it('does not charge us for the opponent throwing it away', () => {
		// Same collapse, but we are Black — so the blunder is not ours.
		const s = scoreGame(game({ ourColour: 'b', evals: [20, 10, -700, -700] }))!;
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

describe('performanceReport', () => {
	it('reports unmeasured games rather than dropping them', () => {
		const r = performanceReport([game(), game({ id: 'g2', evals: undefined })]);
		expect(r.scored.length).toBe(1);
		expect(r.unmeasured).toBe(1);
	});

	it('says nothing when nothing is measurable', () => {
		const r = performanceReport([game({ evals: undefined })]);
		expect(r.accuracy).toBeNull();
		expect(r.recent).toBeNull();
		expect(r.unmeasured).toBe(1);
	});

	it('puts the newest games first, so "recent" means recent', () => {
		const r = performanceReport([
			game({ id: 'old', playedAt: 1 }),
			game({ id: 'new', playedAt: 99 }),
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
		// Four plies, two of which are White's.
		expect(total).toBe(2);
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
