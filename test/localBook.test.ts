// The book that works with no account.
//
// ---------------------------------------------------------------------------
// Will: "when user navigates to site they can't access anything without logging
// in to lichess. But most of our functionality does not require lichess so I
// think that gating is really unnecessary."
//
// Exactly one thing did: the opening explorer. So the trainer's book now comes
// from `openings.json` when there is no token, and what has to be pinned is not
// that the moves are good — the ECO tables have been checked for a century —
// but the two things a substitute book can quietly get wrong: whether it
// actually covers the positions people reach, and whether it claims to know
// things it does not.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { inLocalBook, localBook } from '../src/domain/localBook';
import { INITIAL_FEN, applySan } from '../src/domain/chess';

/** The position after a line of SAN, so tests read as chess. */
const after = (...sans: string[]) => {
	let fen = INITIAL_FEN;
	for (const san of sans) fen = applySan(fen, san).fen;
	return fen;
};

describe('what it knows', () => {
	it('has an opinion about the starting position', () => {
		const { moves } = localBook(INITIAL_FEN);
		const sans = moves.map((m) => m.san);
		expect(sans).toContain('e4');
		expect(sans).toContain('d4');
		expect(sans).toContain('c4');
		expect(sans).toContain('Nf3');
	});

	it('sorts the commonest continuation first and calls it the main line', () => {
		const { moves } = localBook(INITIAL_FEN);
		expect(moves[0].san).toBe('e4');
		expect(moves[0].verdict).toBe('main');
	});

	it('follows real theory several moves deep', () => {
		// 1.e4 e5 2.Nf3 Nc6 — the Ruy, the Italian, the Four Knights, the Scotch.
		const sans = localBook(after('e4', 'e5', 'Nf3', 'Nc6')).moves.map((m) => m.san);
		expect(sans).toEqual(expect.arrayContaining(['Bb5', 'Bc4', 'Nc3', 'd4']));
	});

	it('names a position a line ends on', () => {
		expect(localBook(after('e4', 'e5', 'Nf3', 'Nc6', 'Bb5')).name).toMatch(/ruy lopez|spanish/i);
	});
});

describe('transpositions', () => {
	it('are merged, because the index is keyed by position', () => {
		// The one thing path-matching gets wrong. The Four Knights reached by
		// 3.Nc3 Nf6 and by 3...Nf6 4.Nc3 is the same position, and a book that
		// calls one of them unknown is a book that ends your run for a move order.
		const viaOne = localBook(after('e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6'));
		const viaTwo = localBook(after('e4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6'));
		expect(viaOne.moves.length).toBeGreaterThan(0);
		expect(viaTwo.moves.map((m) => m.san).sort()).toEqual(
			viaOne.moves.map((m) => m.san).sort(),
		);
	});
});

describe('what it does NOT claim', () => {
	it('reports no games, because it has none', () => {
		// Inventing a count so the move table has something to print would put a
		// made-up number beside real ones in the same column. The table shows no
		// "played" figures offline, which is the truth.
		for (const m of localBook(INITIAL_FEN).moves) expect(m.games).toBe(0);
	});

	it('labels its frequency as variations rather than games', () => {
		// `freq` here is the share of NAMED VARIATIONS branching this way. That
		// correlates with what people play and is not it — the Evans Gambit tops
		// the Giuoco Piano in ECO coverage. Every screen that quotes a percentage
		// checks this field first.
		for (const m of localBook(INITIAL_FEN).moves) expect(m.source).toBe('variations');
	});

	it('measures nothing on its own', () => {
		// Soundness is the engine's question in both modes, asked by the caller.
		// Null is "not measured", which is a different statement from "fine".
		for (const m of localBook(INITIAL_FEN).moves) expect(m.cpLoss).toBe(null);
	});
});

describe('where it runs out', () => {
	it('says so, rather than inventing a continuation', () => {
		// Running out of book is the premise of this whole app, not a failure —
		// and the bundled table runs out sooner than the explorer does.
		const junk = after('a3', 'h6', 'a4', 'h5', 'Ra3', 'Rh6');
		expect(localBook(junk).moves).toEqual([]);
		expect(inLocalBook(junk)).toBe(false);
	});

	it('knows the positions it does cover', () => {
		expect(inLocalBook(INITIAL_FEN)).toBe(true);
		expect(inLocalBook(after('e4', 'e5'))).toBe(true);
	});
});
