// Does the pruning lose anything, and does the sweep describe the real board?
//
// ---------------------------------------------------------------------------
// DETECTOR §2 carries a soundness obligation: the claim that no move outside
// `candidates` can cover the obligation set. That is a property to test, not to
// assume — and it is the test that would have caught every relevance error this
// project has made, because every one of them was a filter I convinced myself
// was complete.
//
// So the check is differential in the one direction that matters: run `cover`
// with the pruned generator and again with EVERY legal move, on generated
// positions, and require the concession to be identical. If the pruning ever
// discards the move that saves the day, this fails.
//
// And `obligations` is checked by playing it out. A reported obligation claims
// material comes off; the board is asked whether it does.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import type { Chess } from 'chessops/chess';
import { obligations, cover, candidates, harvest } from '../src/domain/tactics';
import { V, other } from '../src/domain/exchange';
import { positionFromFen, makeSquare } from '../src/domain/chess';

const FILES = 'abcdefgh';
const sq = (f: number, r: number) => `${FILES[f]}${r + 1}`;

function makeRng(seed: number) {
	let s = seed;
	return () => {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		return s / 0x7fffffff;
	};
}

/** Random positions, both sides to move, deliberately contested. */
function randomFen(rng: () => number): string {
	const b = new Map<string, string>();
	b.set('g1', 'K');
	b.set('g8', 'k');
	for (const f of [5, 6, 7]) {
		b.set(sq(f, 1), 'P');
		b.set(sq(f, 6), 'p');
	}
	const roles = ['Q', 'R', 'R', 'B', 'B', 'N', 'N', 'P', 'P'];
	const n = 3 + Math.floor(rng() * 5);
	for (let i = 0; i < n; i++) {
		const role = roles[Math.floor(rng() * roles.length)];
		for (const [colour, ch] of [
			['w', role],
			['b', role.toLowerCase()],
		] as [string, string][]) {
			for (let t = 0; t < 30; t++) {
				const f = Math.floor(rng() * 8);
				const r = colour === 'w' ? 1 + Math.floor(rng() * 5) : 2 + Math.floor(rng() * 5);
				const key = sq(f, r);
				if (b.has(key)) continue;
				b.set(key, ch);
				break;
			}
		}
	}
	const rows: string[] = [];
	for (let r = 7; r >= 0; r--) {
		let row = '';
		let gap = 0;
		for (let f = 0; f < 8; f++) {
			const p = b.get(sq(f, r));
			if (!p) gap++;
			else {
				if (gap) row += gap;
				gap = 0;
				row += p;
			}
		}
		if (gap) row += gap;
		rows.push(row);
	}
	return `${rows.join('/')} w - - 0 1`;
}

function positions(count: number, seed: number): Chess[] {
	const rng = makeRng(seed);
	const out: Chess[] = [];
	for (let i = 0; i < count * 3 && out.length < count; i++) {
		const fen = randomFen(rng);
		for (const turn of [' w ', ' b ']) {
			try {
				const p = positionFromFen(fen.replace(' w ', turn));
				if (p.isEnd()) continue;
				out.push(p);
			} catch {
				/* illegal setup, skip */
			}
			if (out.length >= count) break;
		}
	}
	return out;
}

describe('candidates: the pruning is sound', () => {
	it('never discards the move that would have covered', () => {
		const ps = positions(150, 20260823);
		let compared = 0;
		const wrong: string[] = [];

		for (const p of ps) {
			const pruned = cover(p);
			if (!pruned.obligations.length) continue;
			const full = cover(p, { all: true });
			compared++;
			if (pruned.concession !== full.concession) {
				if (wrong.length < 6) {
					wrong.push(
						`${p.turn} to move  pruned=${pruned.concession} full=${full.concession}  ` +
							`at risk ${pruned.obligations.map((o) => makeSquare(o.square)).join(' ')}`,
					);
				}
			}
		}

		expect(compared).toBeGreaterThan(40);
		expect(wrong, `${wrong.length}/${compared} disagreements:\n${wrong.join('\n')}`).toEqual([]);
	});

	it('is actually smaller than the full move list', () => {
		// Otherwise the test above passes for the wrong reason.
		const ps = positions(120, 771);
		let pruned = 0;
		let full = 0;
		let with_ = 0;
		for (const p of ps) {
			const E = obligations(p.board, p.turn, p.isCheck());
			if (!E.length) continue;
			with_++;
			pruned += candidates(p, p.turn, E).length;
			full += candidates(p, p.turn, []).length;
		}
		expect(with_).toBeGreaterThan(30);
		expect(pruned).toBeLessThan(full * 0.8);
	});
});

describe('obligations: the sweep describes the real board', () => {
	it('material it says is at risk actually comes off', () => {
		const ps = positions(120, 4242);
		let checked = 0;
		const wrong: string[] = [];

		for (const p of ps) {
			// Ask about the side NOT to move, then let the mover collect.
			const victim = other(p.turn);
			const E = obligations(p.board, victim, false);
			for (const o of E) {
				if (!Number.isFinite(o.w)) continue;
				// The best single move the mover has, anywhere.
				const h = harvest(p);
				checked++;
				// A reported obligation must be collectable by SOMETHING, unless
				// the mover is interrupted — which at this depth means in check.
				if (h.value <= 0 && !p.isCheck() && wrong.length < 6) {
					wrong.push(
						`${makeSquare(o.square)} (${o.role}, w=${o.w}) reported at risk but harvest=0`,
					);
				}
				break; // one per position is enough; this is a sweep, not a census
			}
		}
		expect(checked).toBeGreaterThan(30);
		expect(wrong, wrong.join('\n')).toEqual([]);
	});
});

describe('the pieces the formalism names', () => {
	const at = (fen: string) => positionFromFen(fen);

	it('reports a hanging piece, with its cheapest attacker', () => {
		// A knight on d3 attacked by a pawn and nothing defending it.
		const p = at('6k1/5ppp/8/8/8/3n4/2P2PPP/6K1 w - - 0 1');
		const E = obligations(p.board, 'black', false);
		const d3 = E.find((o) => makeSquare(o.square) === 'd3');
		expect(d3?.w).toBe(V.knight);
		expect(d3?.cheapestAttacker).toBe(V.pawn);
	});

	it('counts a check as an obligation of infinite weight', () => {
		const p = at('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
		const black = positionFromFen('6k1/5ppp/8/8/8/8/5PPP/6KR b - - 0 1');
		expect(black.isCheck()).toBe(false);
		const checked = positionFromFen('R5k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1');
		expect(checked.isCheck()).toBe(true);
		const E = obligations(checked.board, 'black', checked.isCheck());
		expect(E[0].w).toBe(Infinity);
		expect(E[0].role).toBe('king');
		void p;
	});

	it('finds a cover when one exists, and reports none when it does not', () => {
		// One piece attacked, and it can simply move: covered.
		const easy = at('6k1/5ppp/8/8/8/3n4/2P2PPP/6K1 b - - 0 1');
		expect(cover(easy).cover).not.toBeNull();
		expect(cover(easy).concession).toBe(0);
	});

	it('a fork has no cover: two obligations, no move answering both', () => {
		// ♘c7 attacks ♚a8 and ♜e8 — check must be answered and the rook falls.
		const forked = at('k3r3/2N5/8/8/8/8/5PPP/6K1 b - - 0 1');
		expect(forked.isCheck()).toBe(true);
		const v = cover(forked);
		expect(v.cover).toBeNull();
		expect(v.concession).toBeGreaterThanOrEqual(V.rook - V.knight);
	});
});
