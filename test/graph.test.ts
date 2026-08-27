// The graph has to be the graph.
//
// ---------------------------------------------------------------------------
// DEFICIENCY.md §7, and PLAN.md M1d.
//
// The strongest test here is not one I wrote by hand. `chessops` computes attack
// sets with magic bitboards; `graph.ts` computes them by walking rays outward
// and stopping at the first occupied square. Two entirely different methods, so
// agreement over thousands of random positions is real evidence rather than a
// restatement of the implementation.
//
// The hand-written cases exist for the LATENT edges, which have no independent
// implementation to check against — they are the thing this module adds, and so
// the thing most able to be confidently wrong. Every expectation below was read
// off a probe first (PLAN.md rule 4), never predicted.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { attacks } from 'chessops/attacks';
import { SquareSet } from 'chessops/squareSet';
import { parseSquare, makeSquare } from 'chessops/util';
import type { Square } from 'chessops/types';
import { positionFromFen } from '../src/domain/chess';
import { build, on, covers, sensitive, latent, fingerprint, isLive, blockedBy } from '../src/domain/graph';

const at = (fen: string) => positionFromFen(fen);
const names = (set: Iterable<Square>) => [...set].map(makeSquare).sort();

/** Deterministic pseudo-random positions: N random legal moves from the start. */
function* corpus(count: number, depth = 24) {
	let seed = 20260825;
	const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
	for (let i = 0; i < count; i++) {
		const pos = at('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
		for (let k = 0; k < depth; k++) {
			const moves: { from: Square; to: Square }[] = [];
			for (const [from, dests] of pos.allDests()) for (const to of dests) moves.push({ from, to });
			if (!moves.length) break;
			const m = moves[Math.floor(rnd() * moves.length)];
			try {
				pos.play(m);
			} catch {
				break;
			}
		}
		yield pos;
	}
}

describe('the live graph, against an independent implementation', () => {
	// The load-bearing test. A ray walk and a magic bitboard have no shared code
	// and no shared bugs.
	it('matches chessops attack sets for every piece, over 400 positions', () => {
		let checked = 0;
		for (const pos of corpus(400)) {
			const g = build(pos.board);
			for (const from of pos.board.occupied) {
				const piece = pos.board.get(from);
				if (!piece) continue;
				const mine = g.from.get(from) ?? SquareSet.empty();
				const theirs = attacks(piece, from, pos.board.occupied);
				expect(names(mine), `${piece.color} ${piece.role} on ${makeSquare(from)}`).toEqual(
					names(theirs),
				);
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(4000);
	});

	it('indexes who bears on a square, by colour', () => {
		// White rook a1 and black rook a8 both bear on a4; nothing between them.
		const g = build(at('r6k/8/8/8/8/8/8/R3K3 w - - 0 1').board);
		const a4 = parseSquare('a4');
		expect(names(on(g, a4, 'white'))).toEqual(['a1']);
		expect(names(on(g, a4, 'black'))).toEqual(['a8']);
		expect(covers(g, a4, 'white')).toBe(true);
		expect(covers(g, parseSquare('h4'), 'black')).toBe(false);
	});

	// A pawn's forward move is not an attack. Treating it as one would put a
	// defended square in the graph that nothing actually defends — and the
	// covering condition would then believe in a defender that cannot capture.
	it('gives a pawn its capture squares only', () => {
		const g = build(at('7k/8/8/8/8/4P3/8/4K3 w - - 0 1').board);
		expect(names(g.from.get(parseSquare('e3')) ?? [])).toEqual(['d4', 'f4']);
	});
});

describe('latent edges — what the index is for', () => {
	it('sees through one blocker and records which square frees it', () => {
		// Rook a1 behind its own pawn a2.
		const board = at('8/8/8/8/8/8/P7/R3K2k w - - 0 1').board;
		const g = build(board);
		const a1 = parseSquare('a1');
		const behind = g.edges.filter(
			(e) => e.from === a1 && !isLive(e, board) && blockedBy(e, board).join() === String(parseSquare('a2')),
		);
		expect(names(behind.map((e) => e.to))).toEqual(['a3', 'a4', 'a5', 'a6', 'a7', 'a8']);
		// And the live segment stops at the pawn it defends.
		expect(names(g.from.get(a1) ?? []).filter((s) => s[0] === 'a')).toEqual(['a2']);
	});

	// The battery, the x-ray and the discovered attack are one row in this table,
	// which is the claim §7 makes and the reason there is no motif list.
	it('records a battery as the back piece x-raying through the front one', () => {
		const board = at('7k/8/8/8/8/8/3R4/3QK3 w - - 0 1').board;
		const g = build(board);
		const d1 = parseSquare('d1');
		const through = g.edges.filter((e) => e.from === d1 && !isLive(e, board));
		expect(
			names(through.filter((e) => blockedBy(e, board).includes(parseSquare('d2'))).map((e) => e.to)),
		).toEqual(['d3', 'd4', 'd5', 'd6', 'd7', 'd8']);
		expect(latent(g, board).length).toBeGreaterThan(0);
	});

	it('gives leapers no latent edges at all — they cannot be blocked', () => {
		const board = at('7k/8/8/8/8/2p1p3/8/3NK3 w - - 0 1').board;
		const g = build(board);
		const d1 = parseSquare('d1');
		expect(g.edges.filter((e) => e.from === d1 && !isLive(e, board))).toEqual([]);
	});

	it('keys the contingency tables by square, both directions', () => {
		const g = build(at('8/8/8/8/8/8/P7/R3K2k w - - 0 1').board);
		// Emptying a2 frees the rook's file.
		expect((g.appearsIfEmpty.get(parseSquare('a2')) ?? []).length).toBe(6);
		// Filling b1 cuts the rook's edge to c1, d1 and e1 — but not to b1 itself,
		// which is the destination rather than an obstruction.
		const dies = g.diesIfFilled.get(parseSquare('b1')) ?? [];
		expect(names(dies.map((e) => e.to))).toEqual(['c1', 'd1', 'e1']);
	});

	// Most of the board is inert. That is the property that makes the index worth
	// keeping: a move to a square in neither table changes nothing about who
	// bears on what.
	//
	it('marks only the squares whose occupancy changes an edge', () => {
		const g = build(at('7k/8/8/8/8/4P3/8/4K3 w - - 0 1').board);
		expect(sensitive(g).size).toBe(0);
	});
});

describe('fingerprint', () => {
	it('is order-independent and distinguishes real differences', () => {
		const a = build(at('r6k/8/8/8/8/8/8/R3K3 w - - 0 1').board);
		const b = build(at('r6k/8/8/8/8/8/8/R3K3 w - - 0 1').board);
		expect(fingerprint(a)).toBe(fingerprint(b));
		const c = build(at('r6k/8/8/8/8/8/P7/R3K3 w - - 0 1').board);
		expect(fingerprint(c)).not.toBe(fingerprint(a));
	});
});
