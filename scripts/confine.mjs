// CONFINEMENT: the escape set, and why the covering enumeration is cheap.
//
// The universe being covered is the ESCAPE SET, not the placement set — mean 4.5
// squares against 44-64 placements — so minimum set cover is exact by DP over
// subsets of F, 2^|F| x placements. Enumerating subsets of placements instead is
// the same mistake as the graph build: C(64,3) = 41,664 for triples alone.
//
// ALSO: safety is RECURSIVE. "Safe on arrival" (SEE(f) <= 0) is that predicate at
// depth 0 used as though it held at every depth. Will: "what about a scenario
// where a piece has only one escape but that new position is only momentarily
// safe?" It is not an edge case — it is most of them.
//
// EXPECTED (offbook/FINDING-CONFINEMENT-IS-CHEAP.md + FINDING-MOMENTARY-SAFETY.md):
//   |F| mean 4.5  median 4  p90 8  p99 11  max 15
//   d=2 T1 kills 33.3%  T2 kills 39.4%  either 42.0%   placements 12.3
//   d=3 T1 kills  2.0%  T2 kills  0.1%  either  2.0%   placements 43.8
//   d=4 T1 kills  0.4%  T2 kills  0.0%  either  0.4%   placements 64.3
//   momentary safety: 578 attackable targets, 82.0% have a momentarily-safe
//   escape, 35.8% have |F| collapse to ZERO — trapped, but read as free.
//
// NOTE T1/T2 are computed here on F_0 and are therefore UNSOUND as written: an
// over-stated escape set makes them declare confinement impossible when the
// uncoverable square never needed covering. They are kept to reproduce the
// recorded figure; a sound early-out must use F_d.
import { load, puzzles, play, other, shifted, mean, q } from './_ladder-lib.mjs';
const N = Number(process.argv[2] ?? 120);
const M = await load(`export { reach } from './src/domain/reach';
export { seeValue } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { attacks } from 'chessops/attacks';
export { makeSquare } from 'chessops/util';`);
const sq = M.makeSquare;
const legal = (position, t) => { const p2 = position.clone(); const o = p2.board.get(t)?.color;
	if (!o) return []; if (p2.turn !== o) p2.turn = o; const ds = p2.allDests().get(t); return ds ? [...ds] : []; };
const winnableIn1 = (board, f, us) => { if (M.seeValue(board, f, us) > 0) return true;
	for (const s of board[us]) { const pc = board.get(s); if (!pc) continue;
		for (const [to, dist] of M.reach(board, s, { limit: 1 }).dist) { if (dist !== 1) continue;
			if (M.seeValue(shifted(board, s, to), f, us) > 0) return true; } } return false; };

const st = {}; for (const D of [2, 3, 4]) st[D] = { n: 0, t1: 0, t2: 0, either: 0, F: [], places: [] };
let attackable = 0, momentary = 0, collapsed = 0;
for (const p of puzzles(N)) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1) {
			const us = pos.turn, them = other(us);
			for (const D of [2, 3, 4]) {
				const cover = new Set(), perMan = [];
				for (const s of pos.board[us]) { const pc = pos.board.get(s); if (!pc) continue; const mine = new Set();
					for (const [to, dist] of M.reach(pos.board, s, { limit: Math.max(1, D - 1) }).dist) { if (dist > D - 1) continue;
						mine.add(to); for (const a of M.attacks(pc, to, pos.board.occupied.without(s).with(to))) mine.add(a); }
					perMan.push(mine); for (const x of mine) cover.add(x); }
				for (const t of pos.board[them]) { const T = pos.board.get(t);
					if (!T || T.role === 'king' || T.role === 'pawn') continue;
					const F = legal(pos, t).filter((f) => M.seeValue(shifted(pos.board, t, f), f, us) <= 0);
					st[D].n++; st[D].F.push(F.length); if (!F.length) continue;
					const t1 = F.some((f) => !cover.has(f));
					let cmax = 0; for (const mine of perMan) { let k = 0; for (const f of F) if (mine.has(f)) k++; if (k > cmax) cmax = k; }
					const t2 = F.length > (D - 1) * Math.max(1, cmax);
					if (t1) st[D].t1++; if (t2) st[D].t2++; if (t1 || t2) st[D].either++;
					let places = 0;
					for (const s of pos.board[us]) { const pc = pos.board.get(s); if (!pc) continue;
						for (const [to, dist] of M.reach(pos.board, s, { limit: Math.max(1, D - 1) }).dist) { if (dist > D - 1) continue;
							const at = M.attacks(pc, to, pos.board.occupied.without(s).with(to));
							if (F.some((f) => f === to || at.has(f))) places++; } }
					st[D].places.push(places);
				}
			}
			// momentary safety — the CONFINEMENT case: not already winnable by exchange,
			// and asked of the board AFTER our attacking move, when it is their turn.
			for (const t of pos.board[them]) { const T = pos.board.get(t);
				if (!T || T.role === 'king' || T.role === 'pawn') continue;
				if (M.seeValue(pos.board, t, us) > 0) continue;
				let best = null;
				outer: for (const s of pos.board[us]) { const pc = pos.board.get(s); if (!pc) continue;
					for (const [to, dist] of M.reach(pos.board, s, { limit: 1 }).dist) { if (dist !== 1) continue;
						const b = shifted(pos.board, s, to); if (M.seeValue(b, t, us) > 0) { best = b; break outer; } } }
				if (!best) continue;
				attackable++;
				const ap = pos.clone(); ap.board = best;
				const F0 = legal(ap, t).filter((f) => M.seeValue(shifted(best, t, f), f, us) <= 0);
				if (!F0.length) continue;
				const F1 = F0.filter((f) => !winnableIn1(shifted(best, t, f), f, us));
				if (F1.length < F0.length) { momentary++; if (!F1.length) collapsed++; }
			}
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
const F = st[2].F;
console.log(`\n  safe-escape set |F|: mean ${mean(F).toFixed(1)}  median ${q(F,0.5)}  p90 ${q(F,0.9)}  p99 ${q(F,0.99)}  max ${Math.max(...F)}   -> set-cover DP is 2^|F| x placements\n`);
for (const D of [2, 3, 4]) { const s = st[D], pc = (x) => `${((100*x)/s.n).toFixed(1)}%`;
	console.log(`  d=${D}  targets ${String(s.n).padStart(4)}   T1 kills ${pc(s.t1).padStart(6)}   T2 kills ${pc(s.t2).padStart(6)}   either ${pc(s.either).padStart(6)}   covering placements ${mean(s.places).toFixed(1)}`); }
console.log(`\n  MOMENTARY SAFETY (recursive escape test)`);
console.log(`    attackable targets                        ${attackable}`);
console.log(`    ...with an escape only momentarily safe   ${momentary}  (${((100*momentary)/Math.max(1,attackable)).toFixed(1)}%)`);
console.log(`    ...where |F| collapses to zero: TRAPPED   ${collapsed}  (${((100*collapsed)/Math.max(1,attackable)).toFixed(1)}%)`);
