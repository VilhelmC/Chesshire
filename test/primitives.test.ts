// The vocabulary — and mostly, what each word REFUSES to be applied to.
//
// The numbers live in `scripts/m4-gate.mjs`, which scores every overlay against
// its Lichess theme over 1,228 solver plies. What is pinned here is the
// definition: the conditions that stop a detector becoming a decoration, one
// test each, so that loosening one fails loudly rather than quietly widening the
// overlay.
//
// EVERY FEN HERE WAS GENERATED AND VERIFIED BY `scripts/m4-cases.mjs` BEFORE IT
// WAS WRITTEN DOWN. Two hand-typed illegal positions have already cost this
// project a debugging session each, and the second one was a position that
// parsed — it simply did not contain the thing the test claimed to be about.
import { describe, it, expect } from 'vitest';
import { positionFromFen } from '../src/domain/chess';
import { makeSquare, parseSquare } from 'chessops/util';
import { moves, mates, forks, hangs, costs, safeMoves, unsafe, forkMarks } from '../src/domain/primitives';

import type { NormalMove, Role } from 'chessops/types';

const at = (fen: string) => positionFromFen(fen);
const LETTER: Partial<Record<Role, string>> = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const uci = (m: NormalMove) => makeSquare(m.from) + makeSquare(m.to) + (m.promotion ? (LETTER[m.promotion] ?? '') : '');
const find = (fen: string, u: string): NormalMove => {
	const m = moves(at(fen)).find((x) => uci(x) === u);
	if (!m) throw new Error(`${u} is not legal in ${fen}`);
	return m;
};

describe('moves', () => {
	it('writes promotions out, one move per piece', () => {
		// ♙e7 with the eighth rank empty: four moves where a naive generator has one.
		// The overlay draws moves, and "e8" is not a move a learner can play.
		const fen = '6k1/4P3/8/8/8/8/5PPP/6K1 w - - 0 1';
		const promos = moves(at(fen)).filter((m) => m.promotion);
		expect(promos.map((m) => uci(m)).sort()).toEqual(['e7e8b', 'e7e8n', 'e7e8q', 'e7e8r']);
	});
});

describe('mates', () => {
	it('finds the back-rank mate', () => {
		const fen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
		expect(mates(at(fen)).map(uci)).toEqual(['a1a8']);
	});

	it('finds none once the king has luft', () => {
		// The same rook, the same rank — ♙h6 instead of ♙h7 and Ra8+ is only a check.
		// One pawn is the whole difference, which is why this is exact and not scored.
		const fen = '6k1/5pp1/7p/8/8/8/5PPP/R5K1 w - - 0 1';
		expect(mates(at(fen))).toEqual([]);
	});
});

describe('forks — the three conditions, one test each', () => {
	const FORK = '2r3k1/5ppp/8/3N4/8/8/5PPP/6K1 w - - 0 1';

	it('finds the knight fork of king and rook', () => {
		const f = forks(at(FORK));
		expect(f).toHaveLength(1);
		expect(uci(f[0].move)).toBe('d5e7');
		expect(f[0].targets.map(makeSquare).sort()).toEqual(['c8', 'g8']);
		// The king contributes no material — it is the forcing half, not the payoff.
		expect(f[0].gain).toBe(500);
	});

	it('(2) is not a fork when the forking man can simply be taken', () => {
		// The identical geometry, plus ♝d8 covering e7. Ne7+ Bxe7 wins nothing, and
		// this is the largest source of false forks by a wide margin — a detector
		// without this condition fires on every knight that can reach a busy square.
		const fen = '2rb2k1/5ppp/8/3N4/8/8/5PPP/6K1 w - - 0 1';
		expect(forks(at(fen))).toEqual([]);
		// And the move is not merely unfound — it is a move that drops a piece.
		expect(costs(at(fen), find(fen, 'd5e7'))).toBe(320);
	});

	it('(1) is not a fork when neither target is worth taking', () => {
		// ♘f4–e6 attacks ♟c7 and ♟g7. Two men, both attacked, nothing won: the knight
		// costs more than either. "Attacks two pieces" would call this a fork.
		const fen = '7k/2p3p1/8/8/5N2/8/5PPP/6K1 w - - 0 1';
		expect(forks(at(fen))).toEqual([]);
		// The geometry really is there; it is the VALUE test that rejects it.
		const e6 = at(fen);
		e6.play(find(fen, 'f4e6'));
		expect([...e6.board.black].map(makeSquare).filter((s) => ['c7', 'g7'].includes(s)).sort()).toEqual(['c7', 'g7']);
	});

	it('draws with fixed words and the men involved', () => {
		const mark = forkMarks(forks(at(FORK))[0]);
		expect(mark.note).toBe('e7 forks c8 and g8');
		expect(mark.squares.map(makeSquare).sort()).toEqual(['c8', 'e7', 'g8']);
	});
});

describe('safe', () => {
	it('names the man that falls, not the square moved to', () => {
		// ♛d5 is attacked by ♖d4. Wherever the queen goes on the d-file or a diagonal
		// the rook covers, the ring belongs on the queen — the square the eye is
		// already on is the one it moved to.
		const fen = '6k1/5ppp/8/3q4/3R4/8/5PPP/6K1 b - - 0 1';
		const h = hangs(at(fen), find(fen, 'd5d6'));
		expect(h && makeSquare(h.square)).toBe('d6');
		expect(h?.loss).toBe(900);
	});

	it('sees a loss a static test cannot: the mover WAS the defender', () => {
		// `scripts/m4-gate.mjs` found this shape, and it is why the overlay runs the
		// search rather than SEE. ♜b8 is holding g8 against ♙g7. Off the eighth rank
		// nothing is attacked at a profit — a per-square exchange sees a quiet
		// position — and the pawn queens on the next ply.
		const fen = '1r6/p5P1/P7/3k1PK1/2p5/1p6/4R3/8 b - - 0 56';
		const off = find(fen, 'b8b5');
		expect(hangs(at(fen), off)).toBeNull(); // the static test: nothing hanging
		expect(costs(at(fen), off)).toBe(800); // the search: a queen arrives
		expect(safeMoves(at(fen)).map(uci)).not.toContain('b8b5');
	});

	it('warns without a ring when there is no square to draw one on', () => {
		// Nothing of ours falls — something of theirs is made. `square` is null and
		// stays null: pointing at the pawn, or at the square vacated, would be
		// inventing a claim the search did not make.
		const fen = '1r6/p5P1/P7/3k1PK1/2p5/1p6/4R3/8 b - - 0 56';
		const u = unsafe(at(fen), find(fen, 'b8b5'));
		expect(u).toEqual({ loss: 800, square: null });
	});

	it('rings the square when SEE can name one', () => {
		const fen = '1r6/p5P1/P7/3k1PK1/2p5/1p6/4R3/8 b - - 0 56';
		const u = unsafe(at(fen), find(fen, 'b8b7'));
		expect(u?.square).toBe(parseSquare('b7'));
	});

	it('holds a position where nothing can be taken', () => {
		const fen = '7k/2p3p1/8/8/5N2/8/5PPP/6K1 w - - 0 1';
		const pos = at(fen);
		expect(safeMoves(pos)).toHaveLength(moves(pos).length);
	});

	it('never calls a mating move unsafe', () => {
		// Material stops being the question once the game is over. Ra8# leaves the
		// rook where a count would call it loose; there is nobody left to take it.
		const fen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
		expect(costs(at(fen), find(fen, 'a1a8'))).toBe(0);
	});
});
