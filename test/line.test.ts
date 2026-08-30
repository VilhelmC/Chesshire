// A quoted line, replayed onto the board.
//
// The property that matters most here is the refusal: a line that does not
// fully apply must be shown as far as it got AND say so. Silently truncating it
// would turn "the first three of these five moves are legal" into "this line is
// three moves long", which is a different and false claim.

import { describe, it, expect } from 'vitest';
import { lineFromSan, lineFromUci, plyOf, stepAt, arrowFor } from '../src/domain/line';
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

	it('points at the move that PRODUCED the position', () => {
		// It used to point at the move about to be played. Will: "When I click a
		// move the next move in the sequence is drawn with an arrow, not what just
		// changed." An arrow is the loudest thing on a board, and pointing it at a
		// move the reader did not click — while the one they did click gets only
		// tinted squares — makes the two channels disagree about the subject.
		expect(arrowFor(line, 0)).toEqual([{ orig: 'e2', dest: 'e4', brush: 'q0' }]);
		expect(arrowFor(line, 1)).toEqual([{ orig: 'e7', dest: 'e5', brush: 'q0' }]);
	});

	it('previews the first move faintly before the line starts', () => {
		// Nothing has been played at -1, so this is the claim rather than a report
		// of it, and the ramp is what says which: q3, not q0.
		expect(arrowFor(line, -1)).toEqual([{ orig: 'e2', dest: 'e4', brush: 'q3' }]);
	});

	it('stays on the last move past the end rather than going blank', () => {
		// `stepAt` clamps the same way. A stepper that shows the final position
		// with no arrow would lose the move that reached it.
		expect(arrowFor(line, 9)).toEqual([{ orig: 'e7', dest: 'e5', brush: 'q0' }]);
	});

	it('draws nothing for a line that did not replay', () => {
		expect(arrowFor(lineFromSan(INITIAL_FEN, ['Qxf7']), -1)).toEqual([]);
	});
});
