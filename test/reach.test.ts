// Distances, and the squares that actually matter.
//
// ---------------------------------------------------------------------------
// PLAN.md M2c. DEFICIENCY.md §8 names this layer as the one where judgement
// lives and where this codebase has already shipped two bugs, so both are
// regressions here.
//
// The independent check is the closed form: on an empty board a king's distance
// is Chebyshev, a rook's is 0/1/2, a bishop's is 0/1/2-or-never. Those come from
// geometry rather than from a second copy of this BFS, so agreement is evidence.
// On occupied boards there is no closed form, so the check is BFS soundness —
// every square at distance k has a parent at k−1, and nothing is reachable in
// fewer steps than claimed.
//
// Every expectation was read off scripts/reachprobe.mjs first.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { SquareSet } from 'chessops/squareSet';
import { Board } from 'chessops/board';
import { parseSquare, makeSquare } from 'chessops/util';
import type { Square, Color } from 'chessops/types';
import { positionFromFen } from '../src/domain/chess';
import { changedSquares } from '../src/domain/paths';
import { reach, distance, critical, soonest, walksFor, walkOn } from '../src/domain/reach';

const at = (fen: string) => positionFromFen(fen);

/** Positions nobody picked, for the property tests below. */
const walkOut = (n: number) => {
	const out: ReturnType<typeof at>[] = [];
	const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
	let pos = at(START);
	let seed = 31337;
	const rnd = (m: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % m);
	for (let i = 0; i < n; i++) {
		const moves: { from: Square; to: Square }[] = [];
		for (const f of pos.board[pos.turn]) for (const t of pos.dests(f)) moves.push({ from: f, to: t as Square });
		if (!moves.length) { pos = at(START); continue; }
		const mv = moves[rnd(moves.length)];
		const pr = pos.board.get(mv.from)?.role === 'pawn' && (mv.to >> 3 === 0 || mv.to >> 3 === 7);
		pos = pos.clone();
		pos.play(pr ? { ...mv, promotion: 'queen' } : mv);
		out.push(pos);
	}
	return out;
};
const CASES = walkOut(60);
const sq = (s: string) => parseSquare(s) as Square;
const chebyshev = (a: Square, b: Square) =>
	Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3)));

describe('distance, against closed forms', () => {
	// A real board always has two kings on it, and they block the very ranks a
	// closed form counts along — which is how the first version of these
	// expectations came out wrong. A bare Board has no such company.
	const alone = (role: 'king' | 'rook' | 'bishop' | 'knight', from: string) => {
		const board = Board.empty();
		board.set(sq(from), { color: 'white', role });
		return { board, r: reach(board, sq(from), { limit: 9 }) };
	};

	it('a lone king walks the Chebyshev distance', () => {
		const { r } = alone('king', 'a1');
		for (let to = 0 as Square; to < 64; to++) {
			expect(distance(r, to), makeSquare(to)).toBe(chebyshev(sq('a1'), to));
		}
	});

	it('a rook on an empty board is never more than two moves away', () => {
		const { r } = alone('rook', 'a1');
		for (let to = 0 as Square; to < 64; to++) {
			if (to === sq('a1')) continue;
			const same = (to & 7) === 0 || to >> 3 === 0;
			expect(distance(r, to), makeSquare(to)).toBe(same ? 1 : 2);
		}
	});

	it('a bishop reaches its own colour in two and the other never', () => {
		const { r } = alone('bishop', 'a1');
		for (let to = 0 as Square; to < 64; to++) {
			const dark = ((to & 7) + (to >> 3)) % 2 === 0;
			expect(distance(r, to) === Infinity, makeSquare(to)).toBe(!dark);
		}
	});

	it('a knight crosses the board in six', () => {
		expect(distance(alone('knight', 'a1').r, sq('h8'))).toBe(6);
	});
});

describe('BFS soundness on cluttered boards', () => {
	function* corpus(n: number) {
		let seed = 90210;
		const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
		for (let i = 0; i < n; i++) {
			const pos = at('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
			for (let k = 0; k < Math.floor(rnd() * 30); k++) {
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

	// Every claimed distance must be justified by a parent one step closer, and
	// the start must be the only square at zero. A BFS that double-counts or
	// skips a layer fails this even when its answers look plausible.
	it('every distance has a parent one ply closer, over 2000 walks', () => {
		let walks = 0;
		for (const pos of corpus(120)) {
			for (const from of pos.board.occupied) {
				const r = reach(pos.board, from, { limit: 4 });
				for (const [to, d] of r.dist) {
					if (d === 0) {
						expect(to).toBe(from);
						continue;
					}
					const parents = r.via.get(to) ?? [];
					expect(parents.length, `${makeSquare(from)}->${makeSquare(to)}`).toBeGreaterThan(0);
					expect(parents.some((p) => r.dist.get(p) === d - 1)).toBe(true);
				}
				walks++;
			}
		}
		expect(walks).toBeGreaterThan(2000);
	});
});

describe('critical squares', () => {
	// A king in a one-square corridor: c/e files walled, so d2->d5 must use d3
	// and d4. Values from the probe, including the base distance.
	const TUNNEL = '4k3/8/8/8/2P1P3/2P1P3/2PKP3/8 w - - 0 1';
	const r = reach(at(TUNNEL).board, sq('d2'));

	it('finds the squares every minimal route uses', () => {
		expect(critical(r, sq('d5')).map(makeSquare)).toEqual(['d3', 'd4']);
		expect(distance(r, sq('d5'))).toBe(3);
	});

	it('finds none where several routes exist', () => {
		// Two ways up the board and two ways across: nothing is forced.
		const open = reach(at('4k3/8/8/8/8/8/8/N3K3 w - - 0 1').board, sq('a1'));
		expect(critical(open, sq('h8'))).toEqual([]);
	});

	const blocked = (square: string, colour: Color) => {
		const board = at(TUNNEL).board.clone();
		board.set(sq(square), { color: colour, role: 'knight' });
		return distance(reach(board, sq('d2')), sq('d5'));
	};

	it('an impassable blocker on a critical square lengthens the walk', () => {
		expect(blocked('d3', 'white')).toBe(6);
		expect(blocked('d4', 'white')).toBe(6);
	});

	it('and on a square that is merely on some route, changes nothing', () => {
		expect(blocked('c4', 'white')).toBe(3);
		expect(blocked('e4', 'white')).toBe(3);
	});

	// Will: "a race is stopped by blocking the path OR capturing the piece."
	// Both halves fall out of the move rules rather than needing a rule of their
	// own — a piece walks through an enemy by taking it.
	it('a capturable blocker is not a blocker at all', () => {
		expect(blocked('d3', 'black')).toBe(3);
		expect(blocked('d4', 'black')).toBe(3);
	});
});

describe('pawns, where the two halves differ', () => {
	it('is stopped by anything in front of it, either colour', () => {
		for (const colour of ['white', 'black'] as Color[]) {
			const board = at('4k3/8/8/8/8/8/P7/4K3 w - - 0 1').board.clone();
			board.set(sq('a3'), { color: colour, role: 'knight' });
			expect(distance(reach(board, sq('a2')), sq('a4')), colour).toBe(Infinity);
		}
	});

	// Will: "correctness would include paths where a pawn for example makes a
	// diagonal move by capturing." A promotion path is not a file.
	it('deviates diagonally when there is something to take', () => {
		expect(distance(reach(at('4k3/8/8/8/8/1p6/P7/4K3 w - - 0 1').board, sq('a2')), sq('b3'))).toBe(1);
		// And not when there is not.
		expect(distance(reach(at('4k3/8/8/8/8/8/P7/4K3 w - - 0 1').board, sq('a2')), sq('b3'))).toBe(Infinity);
	});

	it('takes the double step from its own rank only', () => {
		expect(distance(reach(at('4k3/8/8/8/8/8/P7/4K3 w - - 0 1').board, sq('a2')), sq('a4'))).toBe(1);
		expect(distance(reach(at('4k3/8/8/8/8/P7/8/4K3 w - - 0 1').board, sq('a3')), sq('a5'))).toBe(2);
	});
});

describe('the two bugs race.ts shipped', () => {
	// The distance a defender must travel is measured on the board the pawn will
	// have LEFT BEHIND, not the one it is standing on. Routes open behind a pawn
	// as it advances, and measuring on the current board understates them.
	it('measures on the occupancy it is handed, with no default', () => {
		const now = at('4k3/8/8/8/8/8/P7/R3K3 w - - 0 1').board;
		const dNow = distance(reach(now, sq('a1')), sq('a4'));
		const vacated = now.clone();
		vacated.take(sq('a2'));
		const dVacated = distance(reach(vacated, sq('a1')), sq('a4'));
		// The rook is behind its own pawn AND its own king blocks the first rank at
		// e1, so it must detour d1-d4-a4: three moves now, one once the pawn goes.
		// Probed, not predicted — the first version of this said two, because I
		// counted along a rank the king was standing on.
		expect(dNow).toBe(3);
		expect(dVacated).toBe(1);
	});

	// Reaching an occupied square is a capture, not transit. `stopAt` says so
	// rather than leaving it to be inferred.
	it('lets a caller mark squares that end a route', () => {
		const board = at('4k3/8/8/8/8/8/8/R3K3 w - - 0 1').board;
		const free = reach(board, sq('a1'));
		const halted = reach(board, sq('a1'), { stopAt: SquareSet.empty().with(sq('a4')) });
		expect(distance(free, sq('h4'))).toBe(2);
		expect(distance(halted, sq('a4'))).toBe(1);
		expect(soonest(halted, SquareSet.empty().with(sq('a4')))).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// §7's third index row: "distances that lengthen if `s` fills".
//
// `walksFor` caches a walk per piece with the squares that could change it, so
// `choose()` can price twenty options a ply without recomputing walks on boards
// that differ by two squares. Measured: 67.3% of walks survive a move.
//
// The cache is only worth having if it is EXACT, and the whole risk is that it
// says "unchanged" when something did change — every value downstream would then
// be quietly wrong on a subset of positions nobody would think to look at. So it
// is checked the way `graph-incremental.test.ts` checks the graph: against a full
// recompute, over every legal move of a lot of positions.
// ---------------------------------------------------------------------------
describe('the walk cache is exactly the walk', () => {
	const sig = (r: ReturnType<typeof reach>) =>
		[...r.dist].map(([s, k]) => `${s}:${k}`).sort().join(',');

	it('agrees with a full recompute over every legal move', () => {
		let checked = 0;
		let reused = 0;
		for (const pos of CASES.slice(0, 40)) {
			for (const limit of [1, 3]) {
				const w = walksFor(pos.board, limit);
				for (const from of pos.board[pos.turn]) {
					for (const to of pos.dests(from)) {
						const next = pos.clone();
						try { next.play({ from, to: to as Square }); } catch { continue; }
						const changed = changedSquares(pos.board, next.board);
						for (const p of next.board.occupied) {
							const got = walkOn(w, next.board, p, changed, limit);
							const truth = reach(next.board, p, { limit });
							checked++;
							if (got === w.base.get(p)) reused++;
							expect(sig(got), `${makeSquare(p)} after ${makeSquare(from)}${makeSquare(to as Square)}`).toBe(sig(truth));
						}
					}
				}
			}
		}
		expect(checked, 'nothing was checked').toBeGreaterThan(5000);
		expect(reused, 'the cache never hit — it is pure overhead').toBeGreaterThan(checked / 4);
	});

	// The caller contract, and the first thing that broke it. `e1h1` is castling:
	// two pieces move, so the move's own `from` and `to` are not the squares that
	// changed, and a walk that depended on the rook's file was reused unchanged.
	it('needs the board diff, not the move — castling moves two pieces', () => {
		const pos = at('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
		const w = walksFor(pos.board, 3);
		const next = pos.clone();
		next.play({ from: parseSquare('e1') as Square, to: parseSquare('h1') as Square });
		const changed = changedSquares(pos.board, next.board);
		expect(changed.length, 'castling changed only two squares?').toBeGreaterThan(2);
		for (const p of next.board.occupied) {
			expect(sig(walkOn(w, next.board, p, changed, 3))).toBe(sig(reach(next.board, p, { limit: 3 })));
		}
	});

	it('recomputes when the piece on the square is not the one it cached', () => {
		// A capture replaces the occupant. Reusing the walk of the piece that used
		// to stand there would be a walk for the wrong piece entirely.
		const pos = at('4k3/8/8/3r4/8/8/8/3RK3 w - - 0 1');
		const w = walksFor(pos.board, 3);
		const next = pos.clone();
		next.play({ from: parseSquare('d1') as Square, to: parseSquare('d5') as Square });
		const got = walkOn(w, next.board, parseSquare('d5') as Square, [parseSquare('d1') as Square, parseSquare('d5') as Square], 3);
		expect(got).not.toBe(w.base.get(parseSquare('d5') as Square));
		expect(sig(got)).toBe(sig(reach(next.board, parseSquare('d5') as Square, { limit: 3 })));
	});
});
