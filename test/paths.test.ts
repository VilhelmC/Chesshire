// A cached distance is right, or it is gone.
//
// ---------------------------------------------------------------------------
// PLAN.md M2d, per AMEND-7-ONE-TABLE.md.
//
// The done-when is the shape that made M1's incremental graph safe: an EQUALITY
// against a fresh recomputation after every legal move, over a large corpus —
// not a tolerance, not a drift distribution. If a cached answer survives a move
// it must be identical to the answer computed from scratch; if it cannot be,
// it must have been invalidated.
//
// Will: "anything changes on the path, the race changes immediately and we
// already know how." This is that claim, checked.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { parseSquare, makeSquare } from 'chessops/util';
import type { Square } from 'chessops/types';
import { positionFromFen } from '../src/domain/chess';
import { reach, distance } from '../src/domain/reach';
import { empty, ask, advance, changedSquares, key } from '../src/domain/paths';

const at = (fen: string) => positionFromFen(fen);
const sq = (s: string) => parseSquare(s) as Square;

function* corpus(n: number) {
	let seed = 5150;
	const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
	for (let i = 0; i < n; i++) {
		const pos = at('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
		for (let k = 0; k < Math.floor(rnd() * 26); k++) {
			const moves: { from: Square; to: Square }[] = [];
			for (const [f, dests] of pos.allDests()) for (const t of dests) moves.push({ from: f, to: t });
			if (!moves.length) break;
			try {
				pos.play(moves[Math.floor(rnd() * moves.length)]);
			} catch {
				break;
			}
		}
		yield pos;
	}
}

describe('a surviving cache entry is exactly right', () => {
	// The load-bearing test. Ask every piece about every enemy square, play a
	// move, invalidate, and check that whatever survived still matches a walk
	// computed from nothing on the new board.
	it('over every legal move of 120 positions', () => {
		let survivors = 0;
		let dropped = 0;
		const byD: Record<string, { kept: number; gone: number }> = {};
		const note = (d: number, kept: boolean) => {
			const k = d === Infinity ? 'inf' : String(d);
			(byD[k] ??= { kept: 0, gone: 0 })[kept ? 'kept' : 'gone']++;
		};
		for (const pos of corpus(120)) {
			const before = pos.board.clone();
			for (const [from, dests] of pos.allDests()) {
				for (const to of dests) {
					const next = pos.clone();
					try {
						next.play({ from, to });
					} catch {
						continue;
					}
					const p = empty();
					// Cache a spread of questions on the old board.
					const asked: [Square, Square][] = [];
					for (const a of before.occupied) {
						for (const b of before.occupied) {
							if (a === b) continue;
							ask(p, before, a, b, { limit: 4 });
							asked.push([a, b]);
							if (asked.length >= 40) break;
						}
						if (asked.length >= 40) break;
					}
					const was = new Map([...p.cache].map(([k, v]) => [k, v.d]));
					advance(p, before, next.board);
					for (const [a, b] of asked) {
						const kept = p.cache.get(key(a, b));
						if (!kept) {
							dropped++;
							note(was.get(key(a, b)) ?? Infinity, false);
							continue;
						}
						note(kept.d, true);
						const fresh = distance(reach(next.board, a, { limit: 4 }), b);
						expect(kept.d, `${makeSquare(a)}->${makeSquare(b)} after ${makeSquare(from)}${makeSquare(to)}`).toBe(fresh);
						survivors++;
					}
				}
			}
		}
		// Both numbers must be substantial: all-survivors would mean invalidation
		// never fires, all-dropped would mean the index is useless.
		const rate = Object.fromEntries(
			Object.entries(byD).map(([d, v]) => [d, v.kept / (v.kept + v.gone)]),
		);
		// Both must be substantial: all-survivors would mean invalidation never
		// fires, all-dropped would mean the index is no better than recomputing.
		expect(survivors).toBeGreaterThan(5000);
		expect(dropped).toBeGreaterThan(100);
		// Retention collapses with distance — 60% at d=2, 3% at d=4 when measured.
		// Short-range questions are what the ledger asks most, so a regression that
		// made even those churn would gut the index without failing anything else.
		expect(rate['2']).toBeGreaterThan(0.4);
	});
});

describe('the triggers themselves', () => {
	// A king in a one-square corridor: d2 -> d5 must use d3 and d4.
	const TUNNEL = '4k3/8/8/8/2P1P3/2P1P3/2PKP3/8 w - - 0 1';

	it('gates a walk on the squares every route uses', () => {
		const p = empty();
		const path = ask(p, at(TUNNEL).board, sq('d2'), sq('d5'));
		expect(path.d).toBe(3);
		expect(path.gates.map(makeSquare)).toEqual(['d3', 'd4']);
	});

	it('drops the answer when a gate is filled, and keeps it otherwise', () => {
		for (const [square, shouldDrop] of [
			['d3', true],
			['d4', true],
			['a7', false],
		] as const) {
			const board = at(TUNNEL).board;
			const p = empty();
			ask(p, board, sq('d2'), sq('d5'));
			const after = board.clone();
			after.set(sq(square), { color: 'white', role: 'knight' });
			advance(p, board, after);
			expect(!p.cache.get(key(sq('d2'), sq('d5'))), square).toBe(shouldDrop);
		}
	});

	// The direction that is easy to miss: the square that would SHORTEN the walk
	// is not on the current route at all. It is on a route that does not exist
	// yet, which is why it takes a second walk on an empty board to find.
	it('drops the answer when an obstruction is removed', () => {
		const board = at('4k3/8/8/8/8/8/P7/R3K3 w - - 0 1').board;
		const p = empty();
		const path = ask(p, board, sq('a1'), sq('a4'));
		expect(path.d).toBe(3); // the a2 pawn blocks the file, the e1 king the rank
		expect(path.obstructions.map(makeSquare)).toContain('a2');
		const after = board.clone();
		after.take(sq('a2'));
		advance(p, board, after);
		expect(p.cache.get(key(sq('a1'), sq('a4')))).toBeUndefined();
		// And the fresh answer is the shorter one.
		expect(distance(reach(after, sq('a1')), sq('a4'))).toBe(1);
	});

	it('forgets a question whose piece moved away', () => {
		const board = at('4k3/8/8/8/8/8/8/R3K3 w - - 0 1').board;
		const p = empty();
		ask(p, board, sq('a1'), sq('a8'));
		const after = board.clone();
		after.take(sq('a1'));
		after.set(sq('b1'), { color: 'white', role: 'rook' });
		advance(p, board, after);
		expect(p.cache.get(key(sq('a1'), sq('a8')))).toBeUndefined();
	});
});

describe('a move is a board diff', () => {
	// Same reason as graph.applyMove: castling, en passant and promotion are only
	// "these squares changed contents", so none of them is a special case.
	it('sees both squares of a castle', () => {
		const pos = at('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
		const before = pos.board.clone();
		pos.play({ from: 4 as Square, to: 6 as Square });
		expect(changedSquares(before, pos.board).map(makeSquare).sort()).toEqual(['e1', 'f1', 'g1', 'h1']);
	});

	it('sees the pawn en passant removes, which is not the destination', () => {
		const pos = at('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');
		const before = pos.board.clone();
		pos.play({ from: 36 as Square, to: 43 as Square });
		expect(changedSquares(before, pos.board).map(makeSquare).sort()).toEqual(['d5', 'd6', 'e5']);
	});
});
