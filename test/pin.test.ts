// The pin overlay — the one third of it that survived measurement.
//
// The numbers are in `scripts/m5-gate.mjs` and the deletion is argued in
// `scripts/m5-ablate.mjs`; `primitives/pin.ts` carries both. What is pinned here
// is the geometry and, as much as anything, the two shapes that are NOT pins and
// that a loosened condition would let through.
//
// Every FEN was generated and verified by `scripts/m4-cases.mjs` before it was
// written down. Three of the first six candidates were mislabelled — a rook and
// a king on the same file that were not on the same ray, a "king in front" case
// where the king was in fact behind, and an opening position where the classic
// Bb5 pin does not exist because the d-pawn is still home.
import { describe, it, expect } from 'vitest';
import { positionFromFen } from '../src/domain/chess';
import { makeSquare } from 'chessops/util';
import { pins, pinsOn, pinsCreated, pinsHeld, pinsAgainstMover, pinningMoves, pinMark } from '../src/domain/primitives/pin';
import { moves } from '../src/domain/primitives/core';

import type { NormalMove } from 'chessops/types';

const at = (fen: string) => positionFromFen(fen);
const uci = (m: NormalMove) => makeSquare(m.from) + makeSquare(m.to);
const find = (fen: string, u: string): NormalMove => {
	const m = moves(at(fen)).find((x) => uci(x) === u);
	if (!m) throw new Error(`${u} is not legal in ${fen}`);
	return m;
};

/** ♖d1 — ♞d5 — ♚d8. The knight cannot leave the file. */
const PIN = '3k4/8/8/3n4/8/8/8/3RK3 b - - 0 1';

describe('the geometry', () => {
	it('finds the shield, the king and the pinner', () => {
		const p = pins(at(PIN));
		expect(p).toHaveLength(1);
		expect(makeSquare(p[0].shield)).toBe('d5');
		expect(makeSquare(p[0].king)).toBe('d8');
		expect(makeSquare(p[0].pinner)).toBe('d1');
		expect(p[0].colour).toBe('black');
	});

	it('agrees with the rules: the shield really cannot move off the ray', () => {
		// The claim the overlay makes is a legal one, so it is checkable against the
		// move generator rather than against an opinion. Every legal knight move
		// would leave the d-file, so the knight has none.
		const legal = moves(at(PIN)).filter((m) => makeSquare(m.from) === 'd5');
		expect(legal).toEqual([]);
	});

	it('is NOT a pin when two men stand on the ray', () => {
		// ♟d6 joins ♞d5 between rook and king. Either can move and the other still
		// blocks, so neither is stuck — and this is the condition that stops the
		// detector firing down every half-open file.
		expect(pins(at('3k4/8/3p4/3n4/8/8/8/3RK3 b - - 0 1'))).toEqual([]);
	});

	it('is NOT a pin when the KING is the man in front', () => {
		// ♖d1 — ♚d5 — ♞d8 is a check, which has its own name and its own overlay.
		// Calling it a pin would put a ring round a king that is simply attacked.
		expect(pins(at('3n4/8/8/3k4/8/8/8/3RK3 b - - 0 1'))).toEqual([]);
	});

	it('does not report the relative pin, which did not survive its gate', () => {
		// ♖d1 — ♞d5 — ♛d8: the knight shields a queen. A real idea, and at the base
		// rate however it was narrowed (`m5-ablate.mjs`: +1.5% bare, +0.0% with a
		// real piece, −6.9% with a queen behind at 0% recall). Deleted per Rule 9,
		// and asserted here so that re-adding it is a deliberate act with a
		// measurement attached rather than a quiet widening.
		expect(pins(at('3qk3/8/8/3n4/8/8/8/3RK3 b - - 0 1'))).toEqual([]);
	});
});

describe('whose pin it is', () => {
	it('separates what binds the mover from what the mover holds', () => {
		const pos = at(PIN); // Black to move, and it is Black's knight that is stuck
		expect(pinsAgainstMover(pos)).toHaveLength(1);
		expect(pinsHeld(pos)).toEqual([]);
		expect(pinsOn(pos.board, 'white')).toEqual([]);
	});
});

describe('created, not merely present', () => {
	it('finds the move that sets the pin', () => {
		// ♖h1–d1 pins ♞d5 to ♚d8. Nothing is pinned before it.
		const fen = '3k4/8/8/3n4/8/8/8/K6R w - - 0 1';
		expect(pins(at(fen))).toEqual([]);
		expect(pinningMoves(at(fen)).map(uci)).toEqual(['h1d1']);
		const made = pinsCreated(at(fen), find(fen, 'h1d1'));
		expect(made).toHaveLength(1);
		expect(makeSquare(made[0].shield)).toBe('d5');
	});

	it('does not credit a move for a pin that was already there', () => {
		// The distinction the gate is built on: describing the board scores +13.0%,
		// describing the move scores +43.6%. A move that leaves an existing pin
		// alone has created nothing.
		const fen = '3k4/8/8/3n4/8/8/8/3RK3 w - - 0 1';
		expect(pins(at(fen))).toHaveLength(1);
		expect(pinsCreated(at(fen), find(fen, 'e1e2'))).toEqual([]);
	});
});

describe('the mark', () => {
	it('rings the shield first, and says one fixed sentence', () => {
		const m = pinMark(pins(at(PIN))[0]);
		expect(m.squares.map(makeSquare)).toEqual(['d5', 'd8', 'd1']);
		expect(m.note).toBe('d5 is pinned to the king by d1');
	});
});
