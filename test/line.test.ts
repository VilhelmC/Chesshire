// A quoted line, replayed onto the board.
//
// The property that matters most here is the refusal: a line that does not
// fully apply must be shown as far as it got AND say so. Silently truncating it
// would turn "the first three of these five moves are legal" into "this line is
// three moves long", which is a different and false claim.

import { describe, it, expect } from 'vitest';
import { lineFromSan, lineFromUci, plyOf, stepAt, arrowFor, describeLine } from '../src/domain/line';
import { INITIAL_FEN, applySan } from '../src/domain/chess';

const after = (sans: string[]) => {
	let fen = INITIAL_FEN;
	for (const s of sans) fen = applySan(fen, s).fen;
	return fen;
};

describe('lineFromSan', () => {
	it('replays a legal line and marks it complete', () => {
		const line = lineFromSan(INITIAL_FEN, ['e4', 'e5', 'Nf3']);
		expect(line.complete).toBe(true);
		expect(line.steps.map((s) => s.san)).toEqual(['e4', 'e5', 'Nf3']);
	});

	it('alternates colour from whoever is to move', () => {
		const line = lineFromSan(after(['e4']), ['e5', 'Nf3']);
		expect(line.steps.map((s) => s.colour)).toEqual(['b', 'w']);
	});

	it('numbers from the position, not from one', () => {
		// A line quoted from Black's 6th should say 6, not 1. Otherwise the
		// numbers in the explanation disagree with the numbers in the move list.
		const fen = after(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'd6', 'c3', 'Nf6', 'b4']);
		const line = lineFromSan(fen, ['Bb6']);
		expect(line.steps[0].moveNo).toBe(6);
		expect(line.steps[0].colour).toBe('b');
	});

	it('stops at an illegal move and says the line is incomplete', () => {
		const line = lineFromSan(INITIAL_FEN, ['e4', 'e5', 'Qxf7']);
		expect(line.steps.map((s) => s.san)).toEqual(['e4', 'e5']);
		expect(line.complete).toBe(false);
	});

	it('produces an empty, incomplete line when nothing applies', () => {
		const line = lineFromSan(INITIAL_FEN, ['Qxf7']);
		expect(line.steps).toEqual([]);
		expect(line.complete).toBe(false);
	});
});

describe('lineFromUci', () => {
	it('replays uci and reports the san', () => {
		const line = lineFromUci(INITIAL_FEN, ['e2e4', 'e7e5']);
		expect(line.steps.map((s) => s.san)).toEqual(['e4', 'e5']);
		expect(line.complete).toBe(true);
	});
});

describe('plyOf', () => {
	it('counts plies already played', () => {
		expect(plyOf(INITIAL_FEN)).toBe(0);
		expect(plyOf(after(['e4']))).toBe(1);
		expect(plyOf(after(['e4', 'e5']))).toBe(2);
	});
});

describe('stepAt', () => {
	const line = lineFromSan(INITIAL_FEN, ['e4', 'e5', 'Nf3']);

	it('shows the starting position before the line begins', () => {
		// The claim has to be visible from its starting point too, not only from
		// its conclusion.
		expect(stepAt(line, -1)).toEqual({ fen: INITIAL_FEN });
	});

	it('shows the position after a given move, and which move it was', () => {
		const s = stepAt(line, 0);
		expect(s.fen).toBe(after(['e4']));
		expect(s.lastMove).toEqual(['e2', 'e4']);
	});

	it('clamps past the end rather than going blank', () => {
		expect(stepAt(line, 99).fen).toBe(after(['e4', 'e5', 'Nf3']));
	});

	it('survives a line with no steps', () => {
		const empty = lineFromSan(INITIAL_FEN, ['Qxf7']);
		expect(stepAt(empty, 0).fen).toBe(INITIAL_FEN);
	});
});

describe('arrowFor', () => {
	const line = lineFromSan(INITIAL_FEN, ['e4', 'e5']);

	it('points at the move about to be played', () => {
		// Shown from the CURRENT position, so you see what is coming rather than
		// only what happened.
		expect(arrowFor(line, -1)).toEqual([{ orig: 'e2', dest: 'e4', brush: 'q0' }]);
	});

	it('shows nothing at the end of the line', () => {
		expect(arrowFor(line, 1)).toEqual([]);
	});
});

describe('describeLine', () => {
	it('numbers the way a scoresheet does', () => {
		expect(describeLine(lineFromSan(INITIAL_FEN, ['e4', 'e5', 'Nf3']))).toBe('1.e4 e5 2.Nf3');
	});

	it('marks a line that starts on Black move with an ellipsis', () => {
		expect(describeLine(lineFromSan(after(['e4']), ['e5']))).toBe('1…e5');
	});
});
