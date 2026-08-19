import { describe, it, expect } from 'vitest';
import { movesFromPgn } from '../src/data/games';

describe('movesFromPgn', () => {
	it('reads a plain chess.com-style PGN', () => {
		const pgn = `[Event "Live Chess"]
[Site "Chess.com"]
[White "VilhelmC"]
[Black "someone"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 1-0`;
		expect(movesFromPgn(pgn)).toEqual([
			'e4',
			'e5',
			'Nf3',
			'Nc6',
			'Bc4',
			'Bc5',
			'c3',
			'Nf6',
		]);
	});

	it('strips clock comments, which chess.com puts after every move', () => {
		const pgn =
			'1. e4 {[%clk 0:09:59.9]} 1... e5 {[%clk 0:09:58.1]} 2. Nf3 {[%clk 0:09:57]} 1/2-1/2';
		expect(movesFromPgn(pgn)).toEqual(['e4', 'e5', 'Nf3']);
	});

	it('drops nested variations rather than playing them', () => {
		const pgn = '1. e4 e5 (1... c5 2. Nf3 (2. Nc3 Nc6) 2... d6) 2. Nf3 Nc6';
		expect(movesFromPgn(pgn)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
	});

	it('drops NAGs and rest-of-line comments', () => {
		const pgn = '1. e4! $1 e5 $2 ; this is a comment\n2. Nf3 Nc6';
		expect(movesFromPgn(pgn)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
	});

	it('keeps castling, promotion and check notation', () => {
		const pgn =
			'1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d3 O-O 6. Bg5 h6 7. Bxf6 Qxf6';
		const moves = movesFromPgn(pgn);
		expect(moves).toContain('O-O');
		expect(moves).toContain('Bxf6');
		expect(moves.length).toBe(14);
	});

	it('stops at the first token that will not play, rather than guessing', () => {
		// Qh5 is legal here; Qh9 is not notation at all.
		const moves = movesFromPgn('1. e4 e5 2. Qh5 Nc6 3. Qh9 something');
		expect(moves).toEqual(['e4', 'e5', 'Qh5', 'Nc6']);
	});

	it('returns nothing for a PGN with no moves', () => {
		expect(movesFromPgn('[Event "x"]\n\n*')).toEqual([]);
	});
});
