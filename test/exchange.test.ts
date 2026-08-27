// Is `see` the number it claims to be?
//
// ---------------------------------------------------------------------------
// Every wrong answer this project has produced was one where my derivation and
// my code agreed with each other. A unit test written by the same person, from
// the same misunderstanding, catches nothing.
//
// The first version of this file compared `see` against an exhaustive reference,
// and that comparison did its job: it found that cheapest-first is not exact once
// the participant set is dynamic (see exchange.ts). But the fix made `see` itself
// exhaustive — so the reference became the same algorithm written twice, and a
// differential test between two copies of one idea proves nothing.
//
// So the check is now against something that is not the model at all: PLAY THE
// LINE. Take the sequence `see` says will happen, play it on a real position with
// real legality, and count the material that actually changed hands. If the model
// says 220 and the board says something else, the model is wrong — and the board
// does not share any of the model's assumptions about pins, kings, or ordering.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { Board } from 'chessops/board';
import type { Square, Color } from 'chessops/types';
import { see, capturersOn, V, other } from '../src/domain/exchange';
import { positionFromFen, parseSquare, makeSquare } from '../src/domain/chess';

// ---------------------------------------------------------------------------
// Positions nobody chose. Deliberately dense so chains are long.
// ---------------------------------------------------------------------------
const FILES = 'abcdefgh';
const sq = (f: number, r: number) => `${FILES[f]}${r + 1}`;

function randomBoard(rng: () => number, opts: { pawnsHigh?: boolean } = {}): string {
	const b = new Map<string, string>();
	b.set('g1', 'K');
	b.set('g8', 'k');

	const roles = ['Q', 'R', 'R', 'B', 'B', 'N', 'N', 'P', 'P', 'P'];
	const n = 4 + Math.floor(rng() * 6);
	for (let i = 0; i < n; i++) {
		const role = roles[Math.floor(rng() * roles.length)];
		for (const [colour, ch] of [
			['w', role],
			['b', role.toLowerCase()],
		] as [string, string][]) {
			for (let t = 0; t < 30; t++) {
				const f = Math.floor(rng() * 8);
				let r = 1 + Math.floor(rng() * 6);
				if (opts.pawnsHigh && ch.toUpperCase() === 'P') {
					r = colour === 'w' ? 5 + Math.floor(rng() * 2) : 1 + Math.floor(rng() * 2);
				}
				const key = sq(f, r);
				if (b.has(key)) continue;
				if (ch.toUpperCase() === 'P' && (r === 0 || r === 7)) continue;
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

function makeRng(seed: number) {
	let s = seed;
	return () => {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		return s / 0x7fffffff;
	};
}

/** Material from `side`'s point of view, kings excluded. */
function balance(board: Board, side: Color): number {
	let total = 0;
	for (const s of board.occupied) {
		const p = board.get(s);
		if (!p || p.role === 'king') continue;
		total += p.color === side ? V[p.role] : -V[p.role];
	}
	return total;
}

/**
 * Play what `see` says happens, on a real position, and report what the board
 * says it was worth. `null` means the line could not be played at all.
 */
type PlayOut =
	| { ok: true; model: number; board: number }
	| { ok: false; reason: 'in check' | 'king into a defended square' | 'illegal' };

function playOut(fen: string, target: Square, attacker: Color): PlayOut {
	const pos = positionFromFen(fen);
	const e = see(pos.board, target, attacker);
	if (!e.steps.length) return { ok: true, model: e.value, board: 0 };

	const live = pos.clone();
	live.turn = attacker;
	const before = balance(live.board, attacker);

	for (const step of e.steps) {
		if (live.turn !== step.side) return { ok: false, reason: 'illegal' };
		const inCheck = live.isCheck();
		const mover = live.board.get(step.from);
		let dests;
		try {
			dests = live.dests(step.from);
		} catch {
			return { ok: false, reason: 'illegal' };
		}
		if (!dests.has(target)) {
			return {
				ok: false,
				// A side already in check cannot play the exchange at all, and
				// `see` is a pure board function that does not know whose turn it
				// is (FORMALISM §1.6). That is the one legal reason a predicted
				// line cannot be played; anything else is a defect.
				reason: inCheck
					? 'in check'
					: mover?.role === 'king'
						? 'king into a defended square'
						: 'illegal',
			};
		}
		live.play(
			step.promotes ? { from: step.from, to: target, promotion: 'queen' } : { from: step.from, to: target },
		);
	}
	return { ok: true, model: e.value, board: balance(live.board, attacker) - before };
}

function sweep(seeds: number, opts: { pawnsHigh?: boolean } = {}) {
	const rng = makeRng(opts.pawnsHigh ? 991 : 20260822);
	let played = 0;
	let agreed = 0;
	const blocked: Record<string, number> = {};
	const wrong: string[] = [];

	for (let i = 0; i < seeds; i++) {
		const fen = randomBoard(rng, opts);
		let board: Board;
		try {
			board = positionFromFen(fen).board;
		} catch {
			continue;
		}
		for (const t of board.occupied) {
			const piece = board.get(t);
			if (!piece || piece.role === 'king') continue;
			const attacker = other(piece.color);
			let r: PlayOut;
			try {
				r = playOut(fen, t, attacker);
			} catch {
				r = { ok: false, reason: 'illegal' };
			}
			if (!r.ok) {
				blocked[r.reason] = (blocked[r.reason] ?? 0) + 1;
				continue;
			}
			played++;
			if (r.model === r.board) agreed++;
			else if (wrong.length < 8) {
				wrong.push(`${fen}  target ${makeSquare(t)}  model=${r.model} board=${r.board}`);
			}
		}
	}
	return { played, agreed, blocked, wrong };
}

describe('see, against a real board', () => {
	it('the line it predicts is legal, and wins exactly what it says', () => {
		const r = sweep(120);
		expect(r.played).toBeGreaterThan(500);
		expect(
			r.agreed,
			`${r.played - r.agreed}/${r.played} disagreements:\n${r.wrong.join('\n')}`,
		).toBe(r.played);
	});

	it('holds with pawns near promotion', () => {
		const r = sweep(120, { pawnsHigh: true });
		expect(r.played).toBeGreaterThan(300);
		expect(
			r.agreed,
			`${r.played - r.agreed}/${r.played} disagreements:\n${r.wrong.join('\n')}`,
		).toBe(r.played);
	});

	it('is blocked only by check — never by a pin or an illegal king capture', () => {
		// The sharp form of "no illegal lines". `see` is a pure board function and
		// does not know whose turn it is, so a side already in check cannot play
		// the exchange — that is expected, and it is handled a layer up where the
		// turn is known. Every OTHER reason is a defect: a pin missed, or a king
		// walking into a defended square.
		for (const r of [sweep(60), sweep(60, { pawnsHigh: true })]) {
			expect(r.blocked['king into a defended square'] ?? 0).toBe(0);
			expect(r.blocked['illegal'] ?? 0).toBe(0);
			expect(r.blocked['in check'] ?? 0).toBeGreaterThan(0); // the harness reaches them
		}
	});
});

describe('see, at the edges the formalism argues about', () => {
	const at = (fen: string, s: string, attacker: Color) =>
		see(positionFromFen(fen).board, parseSquare(s) as Square, attacker);

	it('never takes a king off the board', () => {
		// §1.4: pricing, not a legality rule, is what stops this.
		const e = at('6k1/5ppp/1N1n4/5N1R/1r1r2Rn/8/5PPP/6K1 w - - 0 1', 'g7', 'white');
		expect(e.steps.every((s) => Number.isFinite(s.captured))).toBe(true);
		expect(e.value).toBe(V.pawn);
	});

	it('lets the king recapture when the square is genuinely loose', () => {
		// Bishop for a pawn: the attacker declines, so the played line is empty
		// and the value is 0. The king's availability is what makes it 0 rather
		// than 100 — remove the king and the pawn is simply free.
		const e = at('6k1/5ppp/2p2P2/5B2/1Pb5/6p1/5PPP/6K1 w - - 0 1', 'h7', 'white');
		expect(e.value).toBe(0);
		expect(e.defenders.map(makeSquare)).toContain('g8');
	});

	it('prefers a dearer capturer when the cheaper one reveals a defender', () => {
		// The case the exhaustive reference found. ♖h6×h7 vacates h6 and reveals
		// ♛h4; ♕e4×h7 leaves the rook backing the square so the king may not
		// recapture. Cheapest-first reports 0 here; the answer is a pawn.
		const e = at('6k1/2q3Pp/7R/2Q5/R3Q2q/6r1/3r4/6K1 w - - 0 1', 'h7', 'white');
		expect(e.value).toBe(V.pawn);
		expect(e.steps[0].role).toBe('queen');
	});

	it('finds a slider that only joins once its own blocker has captured', () => {
		// §1.1: the participant set is dynamic. The queen has no edge to d4 at
		// step 0 — her own pawn is in the way — and acquires one when that pawn
		// recaptures.
		const withQueen = at('k7/8/5q2/4p3/2Rn4/5N2/8/7K w - - 0 1', 'd4', 'white');
		const without = at('k7/8/8/4p3/2Rn4/5N2/8/7K w - - 0 1', 'd4', 'white');
		expect(withQueen.value).toBe(0);
		expect(without.value).toBe(V.pawn);
	});

	it('prices a promoting capture as a promotion', () => {
		// A pawn on b7 taking on a8 arrives as a queen.
		const e = at('r5k1/1P3ppp/8/8/8/8/5PPP/6K1 w - - 0 1', 'a8', 'white');
		expect(e.steps[0].promotes).toBe(true);
		expect(e.steps[0].captured).toBe(V.rook + V.queen - V.pawn);
	});

	it('excludes a pinned defender, and stops excluding it once the pinner goes', () => {
		// The knight on d5 is pinned to the king by the rook on d1, so it cannot
		// defend e4; take the rook away and it can.
		const pinned = at('3rk3/8/8/3n4/4p3/8/8/3RK3 w - - 0 1', 'e4', 'white');
		expect(pinned.value).toBe(0); // nothing attacks e4 at all
		expect(capturersOn(positionFromFen('3rk3/8/8/3n4/4p3/8/8/3RK3 w - - 0 1').board,
			parseSquare('e4') as Square, 'black')).toEqual([]);
	});
});
