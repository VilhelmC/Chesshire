import { describe, it, expect } from 'vitest';
import {
	census,
	materialReport,
	materialBalance,
	describeBalance,
} from '../src/domain/material';
import { INITIAL_FEN } from '../src/domain/chess';

describe('census', () => {
	it('counts the starting position', () => {
		const c = census(INITIAL_FEN);
		expect(c.w).toEqual({ pawn: 8, knight: 2, bishop: 2, rook: 2, queen: 1, king: 1 });
		expect(c.b).toEqual(c.w);
	});
});

describe('materialReport', () => {
	it('reports nothing taken at the start', () => {
		const r = materialReport(INITIAL_FEN, 'w');
		expect(r.weTook).toEqual([]);
		expect(r.theyTook).toEqual([]);
		expect(r.balance).toBe(0);
	});

	it('lists the pieces actually missing, cheapest first', () => {
		// Black is missing both knights and one pawn; White is intact.
		const fen = 'r1bqkb1r/ppp1pppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
		const r = materialReport(fen, 'w');
		expect(r.weTook).toEqual(['pawn', 'knight', 'knight']);
		expect(r.theyTook).toEqual([]);
		expect(r.balance).toBe(7);
	});

	it('flips with our colour', () => {
		const fen = 'r1bqkb1r/ppp1pppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
		const asBlack = materialReport(fen, 'b');
		expect(asBlack.balance).toBe(-7);
		expect(asBlack.theyTook).toEqual(['pawn', 'knight', 'knight']);
		expect(asBlack.weTook).toEqual([]);
	});

	it('does not invent captures from a promotion', () => {
		// White has promoted a pawn: two queens, seven pawns. Black is untouched.
		// The naive count would say Black "lost" a queen it is still holding.
		const fen = 'rnbqkbnr/pppppppp/8/4Q3/8/8/PPPPPPP1/RNBQKBNR w KQkq - 0 1';
		const r = materialReport(fen, 'w');
		expect(r.promotions.ours).toBe(1);
		// Black has lost nothing — the extra white queen is not a capture.
		expect(r.weTook).toEqual([]);
		// The pawn that became the queen genuinely left the board, and that is all.
		expect(r.theyTook).toEqual(['pawn']);
		expect(r.balance).toBe(8);
	});

	it('never reports a negative number of captures', () => {
		const fen = 'QQQQQQQk/8/8/8/8/8/8/K7 w - - 0 1';
		const r = materialReport(fen, 'b');
		expect(r.weTook.every((x) => typeof x === 'string')).toBe(true);
		expect(r.promotions.theirs).toBeGreaterThan(0);
	});
});

describe('materialBalance', () => {
	it('ignores kings, which never come off', () => {
		expect(materialBalance('4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'w')).toBe(0);
	});

	it('values a rook above a piece above a pawn', () => {
		const rook = materialBalance('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'w');
		const piece = materialBalance('4k3/8/8/8/8/8/8/N3K3 w - - 0 1', 'w');
		const pawn = materialBalance('4k3/8/8/8/8/8/P7/4K3 w - - 0 1', 'w');
		expect(rook).toBeGreaterThan(piece);
		expect(piece).toBeGreaterThan(pawn);
	});
});

describe('describeBalance', () => {
	it('names the edge rather than leaving a number to convert', () => {
		expect(describeBalance(0)).toBe('Material level');
		expect(describeBalance(1)).toBe('You are a pawn up');
		expect(describeBalance(2)).toBe('You are two pawns up');
		expect(describeBalance(3)).toBe('You are a piece up');
		expect(describeBalance(5)).toBe('You are a rook up');
		expect(describeBalance(9)).toBe('You are a queen up');
		expect(describeBalance(-3)).toBe('You are a piece down');
	});
});
