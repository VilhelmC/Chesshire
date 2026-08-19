import { describe, it, expect } from 'vitest';
import {
	glyphForSan,
	withGlyph,
	colourAtPly,
	colourOfFen,
	other,
} from '../src/domain/notation';
import { INITIAL_FEN } from '../src/domain/chess';

describe('glyphForSan', () => {
	it('reads the piece letter', () => {
		expect(glyphForSan('Nf6', 'b')).toBe('♞');
		expect(glyphForSan('Nf3', 'w')).toBe('♘');
		expect(glyphForSan('Qh4+', 'b')).toBe('♛');
		expect(glyphForSan('Rxd8#', 'w')).toBe('♖');
		expect(glyphForSan('Bxc4', 'w')).toBe('♗');
		expect(glyphForSan('Kf1', 'w')).toBe('♔');
	});

	it('treats castling as a king move, both forms', () => {
		expect(glyphForSan('O-O', 'w')).toBe('♔');
		expect(glyphForSan('O-O-O', 'b')).toBe('♚');
	});

	it('falls through to a pawn when there is no piece letter', () => {
		expect(glyphForSan('e4', 'w')).toBe('♙');
		expect(glyphForSan('exd5', 'w')).toBe('♙');
		expect(glyphForSan('c5', 'b')).toBe('♟');
	});

	it('uses the pawn for a promotion, since a pawn is what moves', () => {
		// The piece that MOVES is a pawn; the queen only exists afterwards.
		expect(glyphForSan('e8=Q+', 'w')).toBe('♙');
		expect(glyphForSan('bxa1=N', 'b')).toBe('♟');
	});

	it('distinguishes the two colours everywhere', () => {
		for (const san of ['Nf3', 'Bc4', 'Rd1', 'Qh5', 'Kg1', 'e4', 'O-O']) {
			expect(glyphForSan(san, 'w')).not.toBe(glyphForSan(san, 'b'));
		}
	});
});

describe('withGlyph', () => {
	it('keeps the SAN intact, so the text stays copyable', () => {
		expect(withGlyph('Nf6', 'b')).toBe('♞ Nf6');
		expect(withGlyph('O-O', 'w')).toBe('♔ O-O');
		// The original notation must survive verbatim after the symbol.
		for (const san of ['Bxc4+', 'exd5', 'R1a3', 'Qh4#', 'e8=Q']) {
			expect(withGlyph(san, 'w').endsWith(san)).toBe(true);
		}
	});
});

describe('colour helpers', () => {
	it('maps ply to side, counting from White', () => {
		expect(colourAtPly(0)).toBe('w');
		expect(colourAtPly(1)).toBe('b');
		expect(colourAtPly(6)).toBe('w');
	});

	it('reads the side to move from a FEN', () => {
		expect(colourOfFen(INITIAL_FEN)).toBe('w');
		expect(colourOfFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3')).toBe(
			'b',
		);
	});

	it('falls back rather than throwing on a bad FEN', () => {
		expect(colourOfFen('nonsense')).toBe('w');
		expect(colourOfFen('nonsense', 'b')).toBe('b');
	});

	it('flips', () => {
		expect(other('w')).toBe('b');
		expect(other('b')).toBe('w');
	});
});
