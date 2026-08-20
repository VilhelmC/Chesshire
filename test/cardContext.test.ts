// Stepping back through the game a card came from.
//
// A mistake mined from a real game used to appear as a bare position: you were
// asked what you should have played, without being shown what had just
// happened. For an opening card that is survivable, because the position is
// familiar. For a card from move 24 of one of your own games it removes the
// premise of the question.
//
// The moves are already on every card — `path` — so this is arithmetic, not a
// fetch. These tests pin the indexing, which is the only part that is easy to
// get wrong: replayLine returns the STARTING position at index 0, so there is
// always one more entry than there are moves.

import { describe, it, expect } from 'vitest';
import { replayLine, INITIAL_FEN, sideToMove } from '../src/domain/chess';

const PATH = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5'];

describe('replayLine indexing, as the mistake card uses it', () => {
	const line = replayLine(PATH);

	it('has one more entry than there are moves', () => {
		expect(line.length).toBe(PATH.length + 1);
	});

	it('starts at the initial position, with no move', () => {
		expect(line[0].fen).toBe(INITIAL_FEN);
		expect(line[0].san).toBeNull();
		expect(line[0].uci).toBeNull();
	});

	it('puts the position AFTER ply i at index i', () => {
		expect(line[1].san).toBe('e4');
		expect(sideToMove(line[1].fen)).toBe('b');
		expect(line[2].san).toBe('e5');
		expect(sideToMove(line[2].fen)).toBe('w');
	});

	it('ends on the position the card asks about', () => {
		const last = line[line.length - 1];
		expect(last.san).toBe('Ng5');
		// Seven plies played, so it is Black to move — which is whose mistake
		// this card is about.
		expect(sideToMove(last.fen)).toBe('b');
	});

	it('gives the opponent last move for the highlight', () => {
		// The move that produced the card's position is the final entry's uci,
		// and that is what the board should mark. Showing this is the whole
		// point: it is what just happened to you.
		const last = line[line.length - 1];
		expect(last.uci).toBe('f3g5');
	});

	it('numbers the move list without counting the start position', () => {
		// chips are line.slice(1); chip i has ply i+1 and is White's when i is even.
		const chips = line.slice(1).map((m, i) => ({ san: m.san, ply: i + 1, white: i % 2 === 0 }));
		expect(chips[0]).toMatchObject({ san: 'e4', ply: 1, white: true });
		expect(chips[1]).toMatchObject({ san: 'e5', ply: 2, white: false });
		expect(chips[6]).toMatchObject({ san: 'Ng5', ply: 7, white: true });
	});

	it('survives a path whose moves stop being legal', () => {
		// Truncated rather than thrown: a card from an older format should show
		// what it can rather than nothing at all.
		const broken = replayLine(['e4', 'e5', 'Qz9', 'Nf3']);
		expect(broken.length).toBe(3);
		expect(broken[broken.length - 1].san).toBe('e5');
	});

	it('has nothing to step through for a card with no path', () => {
		expect(replayLine([]).length).toBe(1);
	});
});
