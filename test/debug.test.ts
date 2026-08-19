import { describe, it, expect } from 'vitest';
import { describePosition } from '../src/data/debug';
import { INITIAL_FEN } from '../src/domain/chess';

describe('describePosition', () => {
	it('counts the legal moves the board would offer', () => {
		const r = describePosition(INITIAL_FEN) as {
			legalMoves: number;
			sideToMove: string;
			inCheck: boolean;
		};
		expect(r.legalMoves).toBe(20);
		expect(r.sideToMove).toBe('w');
		expect(r.inCheck).toBe(false);
	});

	it('reports zero legal moves on a finished position, rather than throwing', () => {
		// Fool's mate: Black has mated, White has nothing.
		const mate = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
		const r = describePosition(mate) as { legalMoves: number; gameOver: boolean };
		expect(r.legalMoves).toBe(0);
		expect(r.gameOver).toBe(true);
	});

	it('says so on a bad FEN instead of blowing up the dump', () => {
		const r = describePosition('not a fen') as { error?: string };
		expect(r.error).toBeTruthy();
	});

	it('handles a missing FEN', () => {
		expect((describePosition(null) as { error: string }).error).toBe('no fen');
	});

	it('is the check that distinguishes "board is stuck" from "position is over"', () => {
		// The distinction the dump exists to make: a live position always has
		// moves, so an empty board with a live FEN means the UI is at fault.
		const live = describePosition(
			'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
		) as { legalMoves: number; gameOver: boolean };
		expect(live.gameOver).toBe(false);
		expect(live.legalMoves).toBeGreaterThan(0);
	});
});
