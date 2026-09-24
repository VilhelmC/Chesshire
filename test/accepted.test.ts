// A mistake card has as many answers as the position does.
//
// ---------------------------------------------------------------------------
// Will: "there is a bug in how Mistakes are implemented. It seems only one
// solution is allowed although the card was formed with specific repertoire and
// strictness settings that often have more than one possible solution."
//
// The deck tested `uci === card.expectedUci`, and `expectedUci` is ONE move —
// whichever happened to be first in the accepted set the day the card was made.
// Under `bookSound` or `free` a position routinely has four acceptable moves,
// so three right answers out of four were marked wrong.
//
// `acceptedAt` asks the position instead, through the same ladder the drill
// uses. What is pinned here is that it agrees with that ladder, and the two
// rules that keep a card answerable: the engine speaks when the book is silent,
// and the card's own recorded answer is always in.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { acceptedAt } from '../src/engine/session';
import { INITIAL_FEN, applySan } from '../src/domain/chess';
import type { BookMove } from '../src/domain/book';

/** A stand-in explorer, so none of this needs a network or an engine. */
const book = (moves: BookMove[]) => async () => ({ moves, name: null, eco: null });

const move = (san: string, over: Partial<BookMove> = {}): BookMove => ({
	uci: applySan(INITIAL_FEN, san).uci,
	san,
	verdict: 'book',
	freq: 0.2,
	games: 1000,
	cpLoss: 0,
	name: null,
	...over,
});

describe('what counts as right', () => {
	it('is every sound book move at the loose rung, not just one', () => {
		// The whole bug, in one assertion: four moves in, four moves out.
		return acceptedAt({
			fen: INITIAL_FEN,
			mover: 'w',
			minFreq: 0.01,
			strictness: 'free',
			classify: book([move('e4'), move('d4'), move('Nf3'), move('c4')]),
		}).then((got) => {
			expect(got.map((m) => m.san).sort()).toEqual(['Nf3', 'c4', 'd4', 'e4']);
		});
	});

	it('narrows on a stricter rung, through the same ladder the drill uses', async () => {
		// Not a second copy of the rule — `acceptable` decides, here as in the
		// trainer. This checks the two are wired to each other, not that the
		// ladder works, which `book.test.ts` already owns.
		const got = await acceptedAt({
			fen: INITIAL_FEN,
			mover: 'w',
			minFreq: 0.01,
			strictness: 'bestBook',
			classify: book([
				move('e4', { cpLoss: 0 }),
				move('d4', { cpLoss: 5 }),
				move('Nf3', { cpLoss: 80 }),
			]),
		});
		// e4 and d4 are within the tie tolerance of each other; Nf3 is not.
		expect(got.map((m) => m.san).sort()).toEqual(['d4', 'e4']);
	});

	it('keeps the card answerable when the book is silent', async () => {
		// Half the deck is mined from real games thirty plies deep, where the
		// explorer has nothing. `acceptable` on an empty book is empty, and a card
		// nothing can answer is worse than a card with one answer.
		const got = await acceptedAt({
			fen: INITIAL_FEN,
			mover: 'w',
			minFreq: 0.01,
			strictness: 'bestBook',
			classify: book([]),
			alwaysUci: applySan(INITIAL_FEN, 'e4').uci,
		});
		expect(got.map((m) => m.san)).toContain('e4');
	});

	it('always admits the move the card recorded', async () => {
		// It was accepted once. A later search at a different depth deciding it is
		// 31cp short must not turn a card into one that cannot be solved.
		const got = await acceptedAt({
			fen: INITIAL_FEN,
			mover: 'w',
			minFreq: 0.01,
			strictness: 'bestBook',
			classify: book([move('e4', { cpLoss: 0 }), move('a3', { cpLoss: 200 })]),
			alwaysUci: applySan(INITIAL_FEN, 'a3').uci,
		});
		expect(got.map((m) => m.san).sort()).toEqual(['a3', 'e4']);
	});

	it('survives an explorer that throws', async () => {
		// Offline, or no token. The recorded answer is the floor.
		const got = await acceptedAt({
			fen: INITIAL_FEN,
			mover: 'w',
			minFreq: 0.01,
			strictness: 'free',
			classify: async () => {
				throw new Error('no explorer');
			},
			alwaysUci: applySan(INITIAL_FEN, 'e4').uci,
		});
		expect(got.map((m) => m.san)).toContain('e4');
	});
});
