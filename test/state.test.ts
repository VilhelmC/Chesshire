// The state read off the graph must equal the state read off the board.
//
// ---------------------------------------------------------------------------
// §9: "the state is not the board. It is the exchange complex." §7: "a move is
// three lookups, not a replay."
//
// `state.ts` answers who bears on a square and what an exchange is worth from
// `graph.ts`'s index alone, so that the adversarial collapse can run over the
// graph instead of rebuilding a ledger per option. That is only worth anything
// if the two agree EXACTLY — a graph that is nearly right is a graph that makes
// every downstream number quietly wrong on a subset nobody would think to check.
//
// So this is the same shape as `graph-incremental.test.ts`: the new path against
// the old one, over positions nobody picked, on every square that matters.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { makeSquare } from 'chessops/util';
import type { Color, Square } from 'chessops/types';
import { positionFromFen } from '../src/domain/chess';
import { seeValue, capturersOn, other } from '../src/domain/exchange';
import { stateOf, bearing, value, after } from '../src/domain/state';

const at = (fen: string) => positionFromFen(fen);

const walk = (n: number) => {
	const out: ReturnType<typeof at>[] = [];
	const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
	let pos = at(START);
	let seed = 24601;
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
const CASES = walk(80);

describe('the graph answers what the board answers', () => {
	it('agrees on who bears on every square', () => {
		let checked = 0;
		for (const pos of CASES) {
			const s = stateOf(pos.board);
			for (const sq of pos.board.occupied) {
				for (const side of ['white', 'black'] as Color[]) {
					const fromGraph = [...bearing(s, sq, side)].sort((a, b) => a - b);
					const fromBoard = [...capturersOn(pos.board, sq, side)].sort((a, b) => a - b);
					checked++;
					expect(fromGraph, `${makeSquare(sq)} / ${side}`).toEqual(fromBoard);
				}
			}
		}
		expect(checked).toBeGreaterThan(1000);
	});

	// The one that matters. If this holds, every exchange in the project can be
	// answered without a board, which is what makes the collapse a graph walk.
	it('agrees on what every exchange is worth', () => {
		let checked = 0;
		let nonzero = 0;
		for (const pos of CASES) {
			const s = stateOf(pos.board);
			for (const sq of pos.board.occupied) {
				const owner = pos.board.get(sq)?.color;
				if (!owner) continue;
				const taker = other(owner);
				const fromGraph = value(s, sq, taker);
				const fromBoard = seeValue(pos.board, sq, taker);
				checked++;
				if (fromBoard > 0) nonzero++;
				expect(fromGraph, `${makeSquare(sq)}`).toBe(fromBoard);
			}
		}
		expect(checked).toBeGreaterThan(1000);
		expect(nonzero, 'no exchange in the sample was worth anything — the test is vacuous').toBeGreaterThan(50);
	});

	// §7: "a move is `from` emptying and `to` filling, plus the moving piece's own
	// edge set from its destination." If `after()` gives a state that differs from
	// rebuilding, the incremental claim is false and the collapse cannot use it.
	it('gives after a move what building from scratch gives', () => {
		let moves = 0;
		for (const pos of CASES.slice(0, 30)) {
			const s = stateOf(pos.board);
			for (const from of pos.board[pos.turn]) {
				for (const to of pos.dests(from)) {
					const next = pos.clone();
					const pr = pos.board.get(from)?.role === 'pawn' && ((to as Square) >> 3 === 0 || (to as Square) >> 3 === 7);
					try { next.play(pr ? { from, to: to as Square, promotion: 'queen' } : { from, to: to as Square }); } catch { continue; }
					// Castling and en passant move more than one man; `after()` is the
					// simple case and those are excluded rather than papered over.
					if (next.board.occupied.diff(pos.board.occupied).union(pos.board.occupied.diff(next.board.occupied)).size() > 2) continue;
					moves++;
					const inc = after(s, from, to as Square, pr ? 'queen' : undefined);
					const full = stateOf(next.board);
					for (const sq of next.board.occupied) {
						const owner = next.board.get(sq)?.color;
						if (!owner) continue;
						expect(value(inc, sq, other(owner)), `${makeSquare(sq)} after ${makeSquare(from)}${makeSquare(to as Square)}`).toBe(
							value(full, sq, other(owner)),
						);
					}
				}
			}
		}
		expect(moves, 'no moves were checked').toBeGreaterThan(200);
	});
});
