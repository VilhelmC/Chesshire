// Editing a position by hand.
//
// Trivial-looking string surgery, tested because the Lab's whole purpose is to
// let a person set up a position and check the answer — and a position that is
// silently not the one they set up defeats that completely.

import { describe, it, expect } from 'vitest';
import { flipTurn, place, pieceAt, readable, turnOf } from '../src/views/labEdit';
import { INITIAL_FEN } from '../src/domain/chess';

describe('flipTurn', () => {
	it('changes the side to move and nothing else', () => {
		const flipped = flipTurn(INITIAL_FEN);
		expect(turnOf(flipped)).toBe('black');
		expect(flipped.split(' ')[0]).toBe(INITIAL_FEN.split(' ')[0]);
	});

	it('goes back where it came from', () => {
		expect(flipTurn(flipTurn(INITIAL_FEN))).toBe(INITIAL_FEN.replace(' - 0 1', ' - 0 1'));
	});

	it('drops an en-passant square', () => {
		// It is stated from the mover's side, so carrying it across a flip
		// describes a capture that cannot exist.
		const ep = 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq e6 0 2';
		expect(flipTurn(ep).split(' ')[3]).toBe('-');
	});
});

describe('place', () => {
	const empty = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';

	it('puts a piece down', () => {
		const fen = place(empty, 'd4', { role: 'queen', color: 'white' });
		expect(pieceAt(fen, 'd4')).toEqual({ role: 'queen', color: 'white' });
	});

	it('clears a square', () => {
		const fen = place(place(empty, 'd4', { role: 'queen', color: 'white' }), 'd4', null);
		expect(pieceAt(fen, 'd4')).toBeNull();
	});

	it('replaces what was there', () => {
		const one = place(empty, 'd4', { role: 'queen', color: 'white' });
		const two = place(one, 'd4', { role: 'knight', color: 'black' });
		expect(pieceAt(two, 'd4')).toEqual({ role: 'knight', color: 'black' });
	});

	it('drops castling rights, so the result can be read back', () => {
		// Editing a position that still claims a right belonging to a rook that
		// is no longer home produces a FEN chessops refuses.
		const fen = place(INITIAL_FEN, 'a1', null);
		expect(fen.split(' ')[2]).toBe('-');
		expect(readable(fen)).toBeNull();
	});
});

describe('readable', () => {
	it('accepts an ordinary position', () => {
		expect(readable(INITIAL_FEN)).toBeNull();
	});

	it('refuses a position with no king, and says which', () => {
		const noKing = place('4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'e1', null);
		expect(readable(noKing)).toContain('White');
	});
});
