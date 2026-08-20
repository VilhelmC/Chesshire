// Accuracy, checked against Lichess's own numbers.
//
// The point of implementing THEIR method rather than inventing one is that the
// result can be verified against an independent implementation. These tests are
// that verification: the constants come from lila's source, and the expected
// values are the ones that source produces.

import { describe, it, expect } from 'vitest';
import {
	winPercent,
	winPercentOfMate,
	moveAccuracy,
	gameAccuracy,
	judge,
	countJudgements,
	CP_CEILING,
	CP_INITIAL,
} from '../src/domain/accuracy';

describe('winPercent', () => {
	it('is 50 at a dead level position', () => {
		expect(winPercent(0)).toBeCloseTo(50, 6);
	});

	it('puts the starting position slightly above half', () => {
		// Lichess scores the initial position +15cp, not 0, and every accuracy
		// chain begins there.
		expect(winPercent(CP_INITIAL)).toBeCloseTo(51.38, 1);
	});

	it('tops out at the ceiling rather than reaching 100', () => {
		// Evaluations are clamped to ±1000 BEFORE the logistic, so 97.54 is the
		// highest win percentage any position can have.
		expect(winPercent(CP_CEILING)).toBeCloseTo(97.54, 1);
		expect(winPercent(50_000)).toBeCloseTo(winPercent(CP_CEILING), 6);
	});

	it('is symmetric about zero', () => {
		for (const cp of [10, 75, 300, 900, 5000]) {
			expect(winPercent(cp) + winPercent(-cp)).toBeCloseTo(100, 6);
		}
	});

	it('treats every mate as the same', () => {
		// Mate-in-1 and mate-in-20 are both ±1000cp. A consequence worth knowing:
		// converting a winning position into a forced mate scores no gain.
		expect(winPercentOfMate(1)).toBeCloseTo(winPercentOfMate(20), 6);
		expect(winPercentOfMate(-1)).toBeCloseTo(winPercent(-CP_CEILING), 6);
	});
});

describe('moveAccuracy', () => {
	it('scores a move that improves your chances at exactly 100', () => {
		expect(moveAccuracy(50, 60)).toBe(100);
		expect(moveAccuracy(50, 50)).toBe(100);
	});

	// The values lila's formula produces, including its undocumented +1 bonus.
	it.each([
		[1, 96.6],
		[2, 92.4],
		[5, 80.82],
		[10, 64.58],
		[20, 41.02],
		[40, 15.91],
		[80, 1.0],
	])('a %ipp swing scores about %f', (drop, expected) => {
		expect(moveAccuracy(50, 50 - drop)).toBeCloseTo(expected, 1);
	});

	it('includes the uncertainty bonus, so a hair of a swing is still 100', () => {
		// Without the +1 this would already be below 100. The bonus is in the
		// code and absent from the published page; the code is what Lichess runs.
		expect(moveAccuracy(50, 49.9)).toBe(100);
	});

	it('never leaves the 0–100 range', () => {
		expect(moveAccuracy(97.5, 2.5)).toBeGreaterThanOrEqual(0);
		expect(moveAccuracy(97.5, 2.5)).toBeLessThanOrEqual(100);
	});
});

describe('gameAccuracy', () => {
	/** A quiet game: small oscillations around equality. */
	const quiet = [20, 10, 25, 5, 30, 12, 28, 8, 22, 14, 26, 6];

	it('scores a clean game high for both sides', () => {
		const r = gameAccuracy(quiet);
		expect(r.white).toBeGreaterThan(85);
		expect(r.black).toBeGreaterThan(85);
	});

	it('blames the side that actually blundered', () => {
		// Ply 5 is White's, and it drops the evaluation off a cliff.
		const blunder = [20, 10, 25, 5, -600, 12, 28, 8, 22, 14, 26, 6];
		const r = gameAccuracy(blunder);
		expect(r.white).toBeLessThan(r.black as number);
	});

	it('makes one catastrophe hurt more than an average would', () => {
		// This is what the harmonic mean is for. Eleven fine moves and one
		// disaster must not average out to "mostly fine".
		const clean = gameAccuracy(quiet).white as number;
		const withBlunder = gameAccuracy([20, 10, 25, 5, -800, 12, 28, 8, 22, 14, 26, 6])
			.white as number;
		expect(clean - withBlunder).toBeGreaterThan(10);
	});

	it('reports one accuracy per ply, alternating colour', () => {
		const r = gameAccuracy(quiet);
		expect(r.moves.length).toBe(quiet.length);
		expect(r.moves[0]).toMatchObject({ ply: 1, colour: 'w' });
		expect(r.moves[1]).toMatchObject({ ply: 2, colour: 'b' });
	});

	it('says nothing about a game with no moves', () => {
		expect(gameAccuracy([])).toEqual({ white: null, black: null, moves: [] });
	});

	it('handles a game too short to fill a window', () => {
		const r = gameAccuracy([20, 5]);
		expect(r.white).not.toBeNull();
		expect(r.black).not.toBeNull();
	});

	it('does not punish a side for the opponent improving', () => {
		// Black's position getting better is not White playing badly, and vice
		// versa — each side is scored only on its own moves.
		const r = gameAccuracy([300, 300, 300, 300]);
		expect(r.white).toBeGreaterThan(95);
	});
});

describe('judge', () => {
	it('uses win-percentage drops, not centipawns', () => {
		expect(judge(50, 19)).toBe('blunder');
		expect(judge(50, 29)).toBe('mistake');
		expect(judge(50, 39)).toBe('inaccuracy');
		expect(judge(50, 45)).toBeNull();
	});

	it('ignores a large centipawn swing in an already-decided position', () => {
		// +900 to +600 is 300 centipawns and almost no win percentage. This is
		// exactly the case a centipawn threshold gets wrong.
		const before = winPercent(900);
		const after = winPercent(600);
		expect(before - after).toBeLessThan(10);
		expect(judge(before, after)).toBeNull();
	});

	it('catches a small centipawn swing near equality', () => {
		// 150 either side of level is a real mistake, and a smaller centipawn
		// number than the case above.
		const before = winPercent(75);
		const after = winPercent(-75);
		expect(judge(before, after)).not.toBeNull();
	});
});

describe('countJudgements', () => {
	it('attributes each error to the side that made it', () => {
		// Ply 3 is White's and throws the game away; Black then holds it, so only
		// White is charged. (Ending this array on 10 instead of -700 would make
		// Black hand it straight back — which the counter correctly scored as a
		// second blunder, and which is why this test now holds the evaluation.)
		const counts = countJudgements([20, 10, -700, -700]);
		expect(counts.w.blunder).toBe(1);
		expect(counts.b.blunder).toBe(0);
	});

	it('charges both sides when both throw it away in turn', () => {
		const counts = countJudgements([20, 10, -700, 10]);
		expect(counts.w.blunder).toBe(1);
		expect(counts.b.blunder).toBe(1);
	});

	it('counts nothing in a quiet game', () => {
		const counts = countJudgements([20, 10, 25, 5, 30, 12]);
		expect(counts.w.blunder + counts.w.mistake + counts.w.inaccuracy).toBe(0);
	});
});
