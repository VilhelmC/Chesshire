import { describe, it, expect } from 'vitest';
import { replayLine, INITIAL_FEN, sideToMove } from '../src/domain/chess';

const ITALIAN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'];

describe('replayLine', () => {
	it('gives one position per ply, plus the start', () => {
		const line = replayLine(ITALIAN);
		expect(line.length).toBe(ITALIAN.length + 1);
		expect(line[0].fen).toBe(INITIAL_FEN);
		expect(line[0].san).toBeNull();
	});

	it('indexes by plies played, so index i is the position AFTER i moves', () => {
		const line = replayLine(ITALIAN);
		// This is the invariant the move list depends on: chip ply N shows line[N].
		for (let i = 0; i <= ITALIAN.length; i++) {
			expect(sideToMove(line[i].fen)).toBe(i % 2 === 0 ? 'w' : 'b');
		}
		expect(line[3].san).toBe('Nf3');
		expect(line[6].san).toBe('Bc5');
	});

	it('covers EVERY ply, including the odd ones', () => {
		// The bug this replaces recorded a state only once per submitted move —
		// which advances the path by two — so every odd ply was missing and the
		// move list chip for it did nothing.
		const line = replayLine(ITALIAN);
		for (let i = 1; i <= ITALIAN.length; i++) {
			expect(line[i].uci).toBeTruthy();
			expect(line[i].fen).not.toBe(line[i - 1].fen);
		}
	});

	it('carries the uci, so the previewed move can be highlighted', () => {
		expect(replayLine(['e4'])[1].uci).toBe('e2e4');
		expect(replayLine(ITALIAN)[3].uci).toBe('g1f3');
	});

	it('stops at the first move that will not play, keeping what is real', () => {
		const line = replayLine(['e4', 'e5', 'Qz9', 'Nf3']);
		expect(line.length).toBe(3);
		expect(line[2].san).toBe('e5');
	});

	it('is empty-safe', () => {
		expect(replayLine([]).length).toBe(1);
	});

	it('can start from somewhere other than move 1', () => {
		const from = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
		const line = replayLine(['Bc5'], from);
		expect(line[0].fen).toBe(from);
		expect(line[1].uci).toBe('f8c5');
	});
});
