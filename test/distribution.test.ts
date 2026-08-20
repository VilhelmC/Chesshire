// What players at your band actually play.
//
// The ordering is the argument. This list answers "what will I meet", not
// "what is best", and sorting it by score would quietly turn it back into an
// engine list — a move played once in forty is not worth preparing for however
// well it happens to have scored.

import { describe, it, expect } from 'vitest';
import { distributionOf, movesToCover, sharePercent } from '../src/domain/distribution';
import type { ExplorerResponse } from '../src/domain/types';

const move = (san: string, white: number, draws: number, black: number, rating?: number) => ({
	uci: san,
	san,
	white,
	draws,
	black,
	...(rating === undefined ? {} : { averageRating: rating }),
});

const response = (moves: ReturnType<typeof move>[]): ExplorerResponse => ({
	white: moves.reduce((n, m) => n + m.white, 0),
	draws: moves.reduce((n, m) => n + m.draws, 0),
	black: moves.reduce((n, m) => n + m.black, 0),
	moves,
});

describe('distributionOf', () => {
	it('orders by how often a move is played, not by how well it scores', () => {
		const d = distributionOf(
			response([
				move('common', 100, 100, 300), // played 500 times, scores badly for White
				move('rare', 40, 0, 0), // played 40 times, scores perfectly
			]),
			'w',
		);
		expect(d.moves[0].san).toBe('common');
		expect(d.moves[1].score).toBeGreaterThan(d.moves[0].score);
	});

	it('computes share against the total, not against the biggest', () => {
		const d = distributionOf(response([move('a', 30, 0, 0), move('b', 10, 0, 0)]), 'w');
		expect(d.moves[0].share).toBeCloseTo(0.75);
		expect(d.moves[1].share).toBeCloseTo(0.25);
	});

	it('scores draws as a half, not as a loss', () => {
		// "Wins 40%" is ambiguous about draws, and in openings the draws are
		// where most of the difference between two moves lives.
		const d = distributionOf(response([move('a', 40, 60, 0)]), 'w');
		expect(d.moves[0].score).toBeCloseTo(0.7);
	});

	it('scores from the mover point of view', () => {
		const white = distributionOf(response([move('a', 60, 0, 40)]), 'w');
		const black = distributionOf(response([move('a', 60, 0, 40)]), 'b');
		expect(white.moves[0].score).toBeCloseTo(0.6);
		expect(black.moves[0].score).toBeCloseTo(0.4);
	});

	it('says nothing about a position with no games', () => {
		expect(distributionOf(response([]), 'w')).toEqual({ moves: [], total: 0, score: null });
		expect(distributionOf(null, 'w').total).toBe(0);
	});

	it('reports a missing rating as null rather than zero', () => {
		const d = distributionOf(response([move('a', 1, 0, 0)]), 'w');
		expect(d.moves[0].rating).toBeNull();
	});
});

describe('movesToCover', () => {
	it('answers how much you have to know to be ready for most of it', () => {
		const d = distributionOf(
			response([
				move('a', 50, 0, 0),
				move('b', 30, 0, 0),
				move('c', 15, 0, 0),
				move('d', 5, 0, 0),
			]),
			'w',
		);
		// 50 + 30 + 15 = 95% of games in three moves.
		expect(movesToCover(d, 0.9)).toBe(3);
	});

	it('never claims more coverage than there are moves', () => {
		const d = distributionOf(response([move('a', 10, 0, 0)]), 'w');
		expect(movesToCover(d, 0.99)).toBe(1);
	});
});

describe('sharePercent', () => {
	it('never rounds a real move down to nothing', () => {
		// 0% would say "never played", which is a different and false claim.
		expect(sharePercent(0.004)).toBe('<1%');
	});

	it('gives a decimal only where it carries information', () => {
		expect(sharePercent(0.034)).toBe('3.4%');
		expect(sharePercent(0.42)).toBe('42%');
	});
});
