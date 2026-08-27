// The incremental path and the rebuild must be the same object.
//
// ---------------------------------------------------------------------------
// PLAN.md M1d — the done-when for M1.
//
// This is the test that makes incremental state safe to build on. The classic
// failure of an index is that it drifts from the truth by a fraction of a case:
// a castling rook, an en-passant capture, a promotion — something rare enough
// that the numbers look fine for weeks and then a position is silently wrong.
//
// So: every legal move of thousands of random positions, applied both ways,
// compared by fingerprint. Not sampled.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import type { Square } from 'chessops/types';
import { positionFromFen } from '../src/domain/chess';
import { build, applyMove, fingerprint } from '../src/domain/graph';

const at = (fen: string) => positionFromFen(fen);

function* corpus(count: number, depth = 30) {
	let seed = 424242;
	const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
	for (let i = 0; i < count; i++) {
		const pos = at('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
		for (let k = 0; k < Math.floor(rnd() * depth); k++) {
			const moves: { from: Square; to: Square }[] = [];
			for (const [from, dests] of pos.allDests()) for (const to of dests) moves.push({ from, to });
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

describe('incremental equals rebuild', () => {
	it('over every legal move of 1000 random positions', () => {
		let moves = 0;
		for (const pos of corpus(1000)) {
			const before = pos.board.clone();
			const g = build(before);
			for (const [from, dests] of pos.allDests()) {
				for (const to of dests) {
					const next = pos.clone();
					try {
						next.play({ from, to });
					} catch {
						continue;
					}
					const incremental = fingerprint(applyMove(g, before, next.board));
					const rebuilt = fingerprint(build(next.board));
					expect(incremental, `${pos.turn} ${from}->${to}`).toBe(rebuilt);
					moves++;
				}
			}
		}
		expect(moves).toBeGreaterThan(20000);
	});

	// The three that are not "one piece moves one square", and so the three that
	// an index special-cases wrongly. Diffing the boards means none of them is a
	// special case here — but they are asserted anyway, because that claim is
	// exactly the kind that is comfortable and untrue.
	it('handles castling on both sides', () => {
		for (const [fen, m] of [
			['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', { from: 4, to: 6 }],
			['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', { from: 4, to: 2 }],
			['r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', { from: 60, to: 62 }],
			['r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', { from: 60, to: 58 }],
		] as const) {
			const pos = at(fen);
			const before = pos.board.clone();
			const g = build(before);
			pos.play(m as { from: Square; to: Square });
			expect(fingerprint(applyMove(g, before, pos.board))).toBe(fingerprint(build(pos.board)));
		}
	});

	it('handles en passant, where the captured pawn is not on the destination', () => {
		const pos = at('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');
		const before = pos.board.clone();
		const g = build(before);
		pos.play({ from: 36, to: 43 });
		expect(fingerprint(applyMove(g, before, pos.board))).toBe(fingerprint(build(pos.board)));
	});

	it('handles promotion, where the role changes', () => {
		for (const role of ['queen', 'rook', 'bishop', 'knight'] as const) {
			const pos = at('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
			const before = pos.board.clone();
			const g = build(before);
			pos.play({ from: 48, to: 56, promotion: role });
			expect(fingerprint(applyMove(g, before, pos.board)), role).toBe(fingerprint(build(pos.board)));
		}
	});

	// The whole point of the index: a move that disturbs nothing recomputes
	// almost nothing. If this ever fails, invalidation has gone global and the
	// index is costing more than the rebuild it replaced.
	it('leaves most edges untouched on a quiet move', () => {
		const pos = at('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
		const before = pos.board.clone();
		const g = build(before);
		pos.play({ from: 1, to: 18 });
		const next = applyMove(g, before, pos.board);
		const kept = next.edges.filter((e) => g.edges.some((o) => o.from === e.from && o.to === e.to));
		expect(kept.length / next.edges.length).toBeGreaterThan(0.6);
	});
});
